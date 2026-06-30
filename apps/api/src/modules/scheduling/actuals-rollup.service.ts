import { Inject, Injectable } from '@nestjs/common'
import {
  MASTERDATA_READ_CONTRACT,
  type ConfigReadContract,
  type ExecutionActualDto,
  type LearningReadContract,
  type MasterDataReadContract,
  type OeeDto,
} from '@perduraflow/contracts'
import { BindingResolver } from '../binding/binding.resolver'
import { LEARNING_READ } from '../learning/learning-read.service'
import { CONFIG_READ } from '../config/config-read.service'
import { SchedulingRepository } from './scheduling.repository'
import { startOfDayUtc } from '../../common/utils/working-calendar'
import { bucketStartUtc, bucketStartsInRange, isOrderLate, type OnTimeDefinition, type TrendBucket } from './kpi-measures'

const MS_PER_DAY = 86_400_000
/** Mirrors `ADHERENCE_TOLERANCE_MIN` in the per-version fold (SchedulingService) — an op counts
 *  "on plan" if its actual start is within this many minutes of plan. Kept equal so the trend and the
 *  scorecard's adherence agree on the tolerance. */
const ADHERENCE_TOLERANCE_MIN = 15

/** One point on a KPI trend — `x` is the bucket-start instant (epoch ms), `y` the metric (or `null`
 *  for a period with no executed work). */
export interface KpiTrendPoint {
  x: number
  y: number | null
}

/** Windowed KPI trends for a plant — the actuals-derived series the 902 dashboard charts. OEE is
 *  deliberately ABSENT (current-value tile only: it reads the locked seeded snapshot, no honest trend). */
export interface KpiTrends {
  bucket: TrendBucket
  windowStartMs: number
  windowEndMs: number
  /** Σ good ÷ Σ planned per bucket (attainment). */
  throughput: KpiTrendPoint[]
  /** Σ scrap ÷ (Σ good + Σ scrap) per bucket (scrap rate). */
  scrap: KpiTrendPoint[]
  /** Orders delivered on-time ÷ orders delivered, bucketed by delivery period (uses {@link isOrderLate}). */
  onTime: KpiTrendPoint[]
  /** Ops started within tolerance of plan ÷ executed ops, bucketed by execution period. */
  adherence: KpiTrendPoint[]
}

/**
 * ActualsRollupService — the **one home** for the continuous (windowed, cross-version) actuals→KPI folds
 * (§12.6). Variance/scorecard/cockpit/dashboard read these instead of re-folding raw actuals inline, and
 * actuals are read **only** through `learning.read` (the contract — O1/O2; scheduling never touches
 * learning's tables). Pure code-move from `SchedulingService`; identical math.
 *
 * Scope this pass: the continuous trio (throughput / on-time) + the windowed authority primitive, plus
 * the historical-OEE read. **OEE stays sourced from the seeded `historical_outcome` snapshot** — NOT
 * unified to op_actuals — the demo's seeded OEE is load-bearing. The per-version `versionMetrics` fold
 * stays in `SchedulingService` for now (it's entangled with the lateness-chain DTO assembly shared by
 * the work-list — a separate, larger move, flagged not muddied into this rollup).
 */
@Injectable()
export class ActualsRollupService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly bindings: BindingResolver,
    @Inject(LEARNING_READ) private readonly learning: LearningReadContract,
    @Inject(CONFIG_READ) private readonly config: ConfigReadContract,
  ) {}

  private resolveMasterData(tenantId: string): Promise<MasterDataReadContract> {
    return this.bindings.resolve<MasterDataReadContract>(tenantId, MASTERDATA_READ_CONTRACT)
  }

  /**
   * Resolve the **authoritative** executed-past actuals for the plant over the **Reporting-Policy**
   * window (CONFIG-driven). The shared substrate for every continuous (cross-version, re-solve-stable)
   * plant metric — throughput AND OEE read this so they agree on which actuals count.
   *
   * - **Window:** `[startOfToday − reportingWindowDays, startOfToday)` from the resolved reporting policy.
   * - **Authority:** per `(resource, routingOp, day)` keep the **latest-committed** executing version
   *   present (double-count-proof if a day was ever re-executed under a newer version), then dedupe to
   *   ONE representative per executing op (actuals are seq-ordered → the last cycle wins).
   * - **Honesty:** a day that didn't execute contributes nothing; an empty window → `[]` (→ `null` KPI).
   */
  private async resolveContinuousActuals(
    tenantId: string,
    plantId: string,
  ): Promise<{ authoritative: ExecutionActualDto[]; resourceIds: string[]; windowStartMs: number; windowEndMs: number }> {
    const { reportingWindowDays } = await this.config.resolveReporting(tenantId, plantId)
    const windowEndMs = startOfDayUtc(Date.now())
    const windowStartMs = windowEndMs - reportingWindowDays * MS_PER_DAY
    const { authoritative, resourceIds } = await this.resolveAuthoritativeActuals(tenantId, plantId, windowStartMs, windowEndMs)
    return { authoritative, resourceIds, windowStartMs, windowEndMs }
  }

  /**
   * Fetch → de-version → dedupe the **authoritative** executed actuals for a plant over an ARBITRARY
   * window. Extracted from {@link resolveContinuousActuals} (identical logic) so the trend folds reuse
   * the exact same authority rule over the trend window — one definition of "which actuals count",
   * never two. The current-value folds call it with the reporting window; trends with the trend window.
   */
  private async resolveAuthoritativeActuals(
    tenantId: string,
    plantId: string,
    windowStartMs: number,
    windowEndMs: number,
  ): Promise<{ authoritative: ExecutionActualDto[]; resourceIds: string[] }> {
    const md = await this.resolveMasterData(tenantId)
    const resourceIds = (await md.listResources(tenantId)).filter((r) => r.plantId === plantId).map((r) => r.id)
    const actuals = await this.learning.listActualsForResourcesInWindow(tenantId, resourceIds, windowStartMs, windowEndMs)
    if (actuals.length === 0) return { authoritative: [], resourceIds }

    // Authority: latest-committed executing version per (resource, routingOp, day).
    const versions = await this.repo.findVersionsByIds(tenantId, [...new Set(actuals.map((a) => a.scheduleVersionId))])
    const createdAtById = new Map(versions.map((v) => [v.id, v.createdAt.getTime()]))
    const groupKey = (a: { resourceId: string; routingOperationId: string; actualStart: string }) =>
      `${a.resourceId}::${a.routingOperationId}::${startOfDayUtc(new Date(a.actualStart).getTime())}`
    const bestVersionByGroup = new Map<string, string>()
    for (const a of actuals) {
      const k = groupKey(a)
      const cur = bestVersionByGroup.get(k)
      if (cur === undefined || (createdAtById.get(a.scheduleVersionId) ?? 0) > (createdAtById.get(cur) ?? 0)) {
        bestVersionByGroup.set(k, a.scheduleVersionId)
      }
    }
    // Dedupe to ONE representative per executing op (seq-ordered → last cycle wins).
    const repByOp = new Map<string, ExecutionActualDto>()
    for (const a of actuals) {
      if (bestVersionByGroup.get(groupKey(a)) === a.scheduleVersionId) repByOp.set(a.scheduledOperationId, a)
    }
    return { authoritative: [...repByOp.values()], resourceIds }
  }

  /**
   * Continuous plant-performance throughput over the Reporting-Policy window — Σ good ÷ Σ
   * planned-at-execution across the authoritative executed-past actuals, each measured against the
   * plan that was live when it ran. A fact about the past → **stable across re-solve**. Per-resource
   * + plant; `null` on an empty window (dash, not 0%).
   * @returns plant attainment + per-resource attainment + the resolved window bounds.
   */
  async computePlantThroughput(
    tenantId: string,
    plantId: string,
  ): Promise<{ plant: number | null; byResource: Map<string, number | null>; windowStartMs: number; windowEndMs: number }> {
    const { authoritative, resourceIds, windowStartMs, windowEndMs } = await this.resolveContinuousActuals(tenantId, plantId)
    if (authoritative.length === 0) return { plant: null, byResource: new Map(), windowStartMs, windowEndMs }

    // Planned-at-execution: the executing op's plannedQty (across versions, by exact id).
    const plannedByOp = new Map((await this.repo.findOpsByIds(authoritative.map((a) => a.scheduledOperationId))).map((o) => [o.id, o.plannedQty]))

    let plantGood = 0
    let plantPlanned = 0
    const goodByRes = new Map<string, number>()
    const plannedByRes = new Map<string, number>()
    for (const a of authoritative) {
      const p = plannedByOp.get(a.scheduledOperationId) ?? 0
      plantGood += a.goodQty
      plantPlanned += p
      goodByRes.set(a.resourceId, (goodByRes.get(a.resourceId) ?? 0) + a.goodQty)
      plannedByRes.set(a.resourceId, (plannedByRes.get(a.resourceId) ?? 0) + p)
    }
    const byResource = new Map<string, number | null>()
    for (const rid of resourceIds) {
      const pl = plannedByRes.get(rid) ?? 0
      byResource.set(rid, pl > 0 ? (goodByRes.get(rid) ?? 0) / pl : null)
    }
    return { plant: plantPlanned > 0 ? plantGood / plantPlanned : null, byResource, windowStartMs, windowEndMs }
  }

  /**
   * Continuous **plant On-Time** delivery over the Reporting-Policy window — the cockpit On-Time KPI
   * AND the scorecard's historical-baseline On-Time (one computation, no divergence). ORDER-grain (an
   * order delivered on-time iff its LATEST actual finish in the window ≤ its due), read from the SAME
   * authoritative executed actuals as continuous throughput (latest-committed authority, cross-version
   * → stable across a re-solve). So the seeded historical late deliveries pull it below 100% — a
   * continuous, plan-current view, distinct from the per-version scorecard OTIF. Per-resource: an order
   * counts for every resource it touched in the window (on-time iff the WHOLE order delivered by due).
   * `null` per scope on an empty window (dash, not 100%). Public — the plan-comparison baseline reads it.
   */
  async computePlantOnTime(
    tenantId: string,
    plantId: string,
  ): Promise<{ plant: number | null; byResource: Map<string, number | null> }> {
    const { authoritative, resourceIds } = await this.resolveContinuousActuals(tenantId, plantId)
    if (authoritative.length === 0) return { plant: null, byResource: new Map() }
    const lineByOp = new Map(
      (await this.repo.findOpsByIds(authoritative.map((a) => a.scheduledOperationId))).map((o) => [o.id, o.demandLineId]),
    )
    const dueByLine = new Map(
      (await this.repo.listDemand(tenantId, plantId)).map((d) => [d.demandLineId, d.requiredDate.getTime()]),
    )
    // Per order: its delivery in the window (latest actual finish across its executed ops) + which
    // resources it touched.
    const deliveryByLine = new Map<string, number>()
    const resourcesByLine = new Map<string, Set<string>>()
    for (const a of authoritative) {
      const line = lineByOp.get(a.scheduledOperationId)
      if (!line) continue
      deliveryByLine.set(line, Math.max(deliveryByLine.get(line) ?? 0, new Date(a.actualEnd).getTime()))
      let touched = resourcesByLine.get(line)
      if (!touched) resourcesByLine.set(line, (touched = new Set()))
      touched.add(a.resourceId)
    }
    if (deliveryByLine.size === 0) return { plant: null, byResource: new Map() }
    // The late-test goes through the shared `isOrderLate` measure with the resolved On-Time DEFINITION
    // (KPI/Metric Policy — the configurable measure). Default tolerance 0 ⇒ exactly `delivery > due`
    // (byte-identical to before); a tenant/plant tolerance override changes On-Time here AND in the trend.
    const onTimeDef = (await this.config.resolveKpiPolicy(tenantId, plantId)).onTime
    const lateByLine = new Map<string, boolean>()
    for (const [line, delivery] of deliveryByLine) {
      lateByLine.set(line, isOrderLate(delivery, dueByLine.get(line) ?? null, onTimeDef))
    }
    const plant = deliveryByLine.size > 0 ? [...lateByLine.values()].filter((late) => !late).length / deliveryByLine.size : null
    const onTimeByRes = new Map<string, number>()
    const totalByRes = new Map<string, number>()
    for (const [line, touched] of resourcesByLine) {
      const late = lateByLine.get(line) ?? false
      for (const rid of touched) {
        totalByRes.set(rid, (totalByRes.get(rid) ?? 0) + 1)
        if (!late) onTimeByRes.set(rid, (onTimeByRes.get(rid) ?? 0) + 1)
      }
    }
    const byResource = new Map<string, number | null>()
    for (const rid of resourceIds) {
      const total = totalByRes.get(rid) ?? 0
      byResource.set(rid, total > 0 ? (onTimeByRes.get(rid) ?? 0) / total : null)
    }
    return { plant, byResource }
  }

  /**
   * Continuous **historical OEE** (A·P·Q) for the cockpit — aggregated from the seeded `historical_outcome`
   * (measured_historical) rows whose period overlaps the Reporting-Policy window. **LOCKED to that seeded
   * source this pass** (NOT derived from op_actuals — the demo's seeded OEE is load-bearing). The SAME
   * source the scorecard's "Historical" baseline arm reads (no divergence), plan-independent and present
   * from `demo:reset`. `null` per scope when no in-window rows exist (the honest empty state).
   * @returns plant OEE + per-resource OEE (both `null` when the window has no rows for that scope).
   */
  async computeHistoricalOee(
    tenantId: string,
    plantId: string,
  ): Promise<{ plant: OeeDto | null; byResource: Map<string, OeeDto | null> }> {
    const { reportingWindowDays } = await this.config.resolveReporting(tenantId, plantId)
    const windowEndMs = startOfDayUtc(Date.now())
    const windowStartMs = windowEndMs - reportingWindowDays * MS_PER_DAY
    const rows = (await this.repo.listHistoricalOutcomes(tenantId, plantId)).filter(
      (r) => r.periodEnd.getTime() > windowStartMs && r.periodStart.getTime() < windowEndMs && r.oee != null,
    )
    type Row = (typeof rows)[number]
    const agg = (subset: Row[]): OeeDto | null => {
      if (subset.length === 0) return null
      const mean = (sel: (r: Row) => number | null): number => {
        const vals = subset.map(sel).filter((v): v is number => v != null)
        return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
      }
      const availability = mean((r) => r.oeeAvailability)
      const performance = mean((r) => r.oeePerformance)
      const quality = mean((r) => r.oeeQuality)
      return { availability, performance, quality, oee: availability * performance * quality }
    }
    // Plant = aggregate ALL in-window rows (blend + per-line), the SAME scope the scorecard's
    // measured_historical baseline arm uses (`listHistoricalOutcomes(plantId)` with no resourceId) —
    // so the cockpit headline and the Historical baseline show the identical number (no divergence, #6).
    const plant = agg(rows)
    const byResource = new Map<string, OeeDto | null>()
    for (const rid of new Set(rows.filter((r) => r.resourceId != null).map((r) => r.resourceId as string))) {
      byResource.set(rid, agg(rows.filter((r) => r.resourceId === rid)))
    }
    return { plant, byResource }
  }

  /**
   * Windowed KPI **trends** for the 902 dashboard — **additive** (never touches the current-value folds,
   * so parity holds) and built on the SAME {@link resolveAuthoritativeActuals} authority over a trailing
   * trend window. Per-KPI source (see the 902 build doc, Part 2 — "identify and report, don't assume"):
   *  - **throughput, scrap, adherence** — pure actuals, bucketed by the op's EXECUTION period.
   *  - **on-time** — ORDER-grain, bucketed by DELIVERY period, judged by the same {@link isOrderLate}
   *    measure as the current-value tile (so the tile and its trend can't diverge). NOTE: this is the
   *    delivery-bucketed continuous on-time, NOT the per-version OTIF sequence — chosen so trend and tile
   *    share one definition; reported as a deliberate source choice.
   *  - **OEE** — ABSENT: the locked seeded snapshot is a single period; a per-period trend would either
   *    move the locked value or fabricate a line. Current-value tile only.
   *  - **churn, cost** — version-sequence metrics (not actuals-windowed); not in this actuals trend.
   * Empty buckets surface as `{ y: null }` (an honest gap, never a fabricated 0). `onTimeDef` is the
   * resolved On-Time definition (Part 4 passes the cascade value; the default reproduces current behavior).
   */
  async computeKpiTrends(
    tenantId: string,
    plantId: string,
    opts?: { bucket?: TrendBucket; trendDays?: number; onTimeDef?: OnTimeDefinition },
  ): Promise<KpiTrends> {
    const bucket = opts?.bucket ?? 'day'
    // Same resolved On-Time definition as the current-value tile, so the trend can't diverge from it.
    const onTimeDef = opts?.onTimeDef ?? (await this.config.resolveKpiPolicy(tenantId, plantId)).onTime
    const { reportingWindowDays } = await this.config.resolveReporting(tenantId, plantId)
    const trendDays = opts?.trendDays ?? reportingWindowDays
    const windowEndMs = startOfDayUtc(Date.now())
    const windowStartMs = windowEndMs - trendDays * MS_PER_DAY
    const starts = bucketStartsInRange(windowStartMs, windowEndMs, bucket)
    const nullSeries = (): KpiTrendPoint[] => starts.map((x) => ({ x, y: null }))

    const { authoritative } = await this.resolveAuthoritativeActuals(tenantId, plantId, windowStartMs, windowEndMs)
    if (authoritative.length === 0) {
      return { bucket, windowStartMs, windowEndMs, throughput: nullSeries(), scrap: nullSeries(), onTime: nullSeries(), adherence: nullSeries() }
    }

    const opById = new Map((await this.repo.findOpsByIds(authoritative.map((a) => a.scheduledOperationId))).map((o) => [o.id, o]))
    const dueByLine = new Map((await this.repo.listDemand(tenantId, plantId)).map((d) => [d.demandLineId, d.requiredDate.getTime()]))

    // Execution-period accumulators (throughput / scrap / adherence) + per-order delivery for on-time.
    type Acc = { good: number; planned: number; scrap: number; adhereOnTime: number; adhereTotal: number }
    const byBucket = new Map<number, Acc>()
    const acc = (b: number): Acc => {
      let a = byBucket.get(b)
      if (!a) byBucket.set(b, (a = { good: 0, planned: 0, scrap: 0, adhereOnTime: 0, adhereTotal: 0 }))
      return a
    }
    const deliveryByLine = new Map<string, number>()
    for (const a of authoritative) {
      const op = opById.get(a.scheduledOperationId)
      if (!op) continue
      const acm = acc(bucketStartUtc(new Date(a.actualStart).getTime(), bucket))
      acm.good += a.goodQty
      acm.scrap += a.scrapQty
      acm.planned += op.plannedQty
      acm.adhereTotal += 1
      if (Math.abs(new Date(a.actualStart).getTime() - op.plannedStart.getTime()) <= ADHERENCE_TOLERANCE_MIN * 60_000) acm.adhereOnTime += 1
      if (op.demandLineId) deliveryByLine.set(op.demandLineId, Math.max(deliveryByLine.get(op.demandLineId) ?? 0, new Date(a.actualEnd).getTime()))
    }
    const otByBucket = new Map<number, { onTime: number; total: number }>()
    for (const [line, delivery] of deliveryByLine) {
      const b = bucketStartUtc(delivery, bucket)
      let o = otByBucket.get(b)
      if (!o) otByBucket.set(b, (o = { onTime: 0, total: 0 }))
      o.total += 1
      if (!isOrderLate(delivery, dueByLine.get(line) ?? null, onTimeDef)) o.onTime += 1
    }

    return {
      bucket,
      windowStartMs,
      windowEndMs,
      throughput: starts.map((x) => {
        const a = byBucket.get(x)
        return { x, y: a && a.planned > 0 ? a.good / a.planned : null }
      }),
      scrap: starts.map((x) => {
        const a = byBucket.get(x)
        const denom = a ? a.good + a.scrap : 0
        return { x, y: a && denom > 0 ? a.scrap / denom : null }
      }),
      adherence: starts.map((x) => {
        const a = byBucket.get(x)
        return { x, y: a && a.adhereTotal > 0 ? a.adhereOnTime / a.adhereTotal : null }
      }),
      onTime: starts.map((x) => {
        const o = otByBucket.get(x)
        return { x, y: o && o.total > 0 ? o.onTime / o.total : null }
      }),
    }
  }
}
