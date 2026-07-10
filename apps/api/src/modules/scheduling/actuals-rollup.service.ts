import { Inject, Injectable } from '@nestjs/common'
import {
  ASSET_READ_CONTRACT,
  type ConfigReadContract,
  type ExecutionActualDto,
  type KpiDashboardDto,
  type KpiThresholdKey,
  type KpiTileDto,
  type LearningReadContract,
  type AssetReadContract,
  type OeeDto,
} from '@perduraflow/contracts'
import { BindingResolver } from '../binding/binding.resolver'
import { LEARNING_READ } from '../learning/learning-read.service'
import { CONFIG_READ } from '../config/config-read.service'
import { matchesLocation } from './location'
import { SchedulingRepository } from './scheduling.repository'
import { startOfDayUtc } from '../../common/utils/working-calendar'
import {
  accumulateOee,
  bucketStartUtc,
  bucketStartsInRange,
  emptyOeeAccumulator,
  isOrderLate,
  kpiStatus,
  type OeeAccumulator,
  oeeFromAccumulator,
  type OnTimeDefinition,
  type TrendBucket,
} from './kpi-measures'

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

/** Window-aggregate current value per actuals-derived KPI — the dashboard tile's headline number,
 *  folded from the SAME authoritative actuals as the trend (so tile and trend agree). `null` on empty. */
export interface KpiCurrentValues {
  onTime: number | null
  throughput: number | null
  scrap: number | null
  adherence: number | null
}

/** Per-period OEE (A·P·Q + combined) trends over the window — the OEE card's charts. */
export interface OeeTrend {
  oee: KpiTrendPoint[]
  availability: KpiTrendPoint[]
  performance: KpiTrendPoint[]
  quality: KpiTrendPoint[]
}

/** OEE derived from ACTUALS (not the seeded snapshot) — plant + per-resource current value + the
 *  windowed trend. The real measured OEE, and the source that makes an honest A·P·Q trend possible. */
export interface OeeFromActuals {
  plant: OeeDto | null
  byResource: Map<string, OeeDto | null>
  trend: OeeTrend
  bucket: TrendBucket
  windowStartMs: number
  windowEndMs: number
}

/** Windowed KPI trends + window-aggregate current values for a plant — the actuals-derived KPIs the 902
 *  dashboard charts. OEE is handled separately by {@link ActualsRollupService.computeOeeFromActuals}
 *  (it needs its own A·P·Q accumulation, and feeds both the dashboard and the cockpit). */
export interface KpiTrends {
  bucket: TrendBucket
  windowStartMs: number
  windowEndMs: number
  /** Window-aggregate current values (the tile headline) for the four actuals KPIs. */
  current: KpiCurrentValues
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
 * Folds here: the continuous throughput / on-time, the windowed KPI trends, and **OEE from actuals**
 * (`computeOeeFromActuals` — A·P·Q current + trend, the same fold as the per-version scorecard). OEE is
 * no longer read from the seeded `historical_outcome` snapshot (that stays only for the scorecard's
 * measured-historical *baseline* comparison). The per-version `versionMetrics` fold stays in
 * `SchedulingService` for now (entangled with the lateness-chain DTO assembly shared by the work-list).
 */
@Injectable()
export class ActualsRollupService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly bindings: BindingResolver,
    @Inject(LEARNING_READ) private readonly learning: LearningReadContract,
    @Inject(CONFIG_READ) private readonly config: ConfigReadContract,
  ) {}

  private resolveAsset(tenantId: string): Promise<AssetReadContract> {
    return this.bindings.resolve<AssetReadContract>(tenantId, ASSET_READ_CONTRACT)
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
    lineId?: string,
  ): Promise<{ authoritative: ExecutionActualDto[]; resourceIds: string[] }> {
    const asset = await this.resolveAsset(tenantId)
    // S0a: optional line filter — plant-grain unchanged when `lineId` is absent.
    const resourceIds = (await asset.listResources(tenantId)).filter((r) => matchesLocation(r, plantId, lineId)).map((r) => r.id)
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
   * **OEE from ACTUALS** (A·P·Q) over the Reporting-Policy window — the real measured OEE, computed with
   * the SAME fold as the per-version scorecard ({@link oeeFromAccumulator}) but continuous/windowed and
   * bucketed for a trend. This is the OEE source for the cockpit + dashboard (replacing the earlier
   * seeded-snapshot read), so OEE gains an honest per-period A·P·Q trend and one consistent source.
   * (The seeded `historical_outcome` stays only for the scorecard's measured-historical *baseline*
   * comparison, read directly by `plan-comparison.service`.)
   * Returns plant + per-resource current values + the windowed OEE/A/P/Q trend. `null` where a scope /
   * period has no executed actuals (a gap, not 0%).
   */
  async computeOeeFromActuals(
    tenantId: string,
    plantId: string,
    opts?: { bucket?: TrendBucket; trendDays?: number },
  ): Promise<OeeFromActuals> {
    const bucket = opts?.bucket ?? 'day'
    const { reportingWindowDays } = await this.config.resolveReporting(tenantId, plantId)
    const trendDays = opts?.trendDays ?? reportingWindowDays
    const windowEndMs = startOfDayUtc(Date.now())
    const windowStartMs = windowEndMs - trendDays * MS_PER_DAY
    const starts = bucketStartsInRange(windowStartMs, windowEndMs, bucket)
    const nullSeries = (): KpiTrendPoint[] => starts.map((x) => ({ x, y: null }))
    const emptyTrend = (): OeeTrend => ({ oee: nullSeries(), availability: nullSeries(), performance: nullSeries(), quality: nullSeries() })

    const { authoritative, resourceIds } = await this.resolveAuthoritativeActuals(tenantId, plantId, windowStartMs, windowEndMs)
    if (authoritative.length === 0) {
      return { plant: null, byResource: new Map(resourceIds.map((r) => [r, null])), trend: emptyTrend(), bucket, windowStartMs, windowEndMs }
    }
    const opById = new Map((await this.repo.findOpsByIds(authoritative.map((a) => a.scheduledOperationId))).map((o) => [o.id, o]))

    const total = emptyOeeAccumulator()
    const byRes = new Map<string, OeeAccumulator>()
    const byBucket = new Map<number, OeeAccumulator>()
    const accFor = (map: Map<string | number, OeeAccumulator>, key: string | number): OeeAccumulator => {
      let a = map.get(key)
      if (!a) map.set(key, (a = emptyOeeAccumulator()))
      return a
    }
    for (const a of authoritative) {
      const op = opById.get(a.scheduledOperationId)
      if (!op) continue
      const fold = {
        opMinutes: (new Date(a.actualEnd).getTime() - new Date(a.actualStart).getTime()) / 60_000,
        setupMinutes: a.actualSetupTime ?? 0,
        downtimeMinutes: a.downtimeMinutes,
        stdCycle: op.cycleTime, // the op's std cycle per unit — mirrors the per-version fold
        good: a.goodQty,
        scrap: a.scrapQty,
      }
      accumulateOee(total, fold)
      accumulateOee(accFor(byRes as Map<string | number, OeeAccumulator>, a.resourceId), fold)
      accumulateOee(accFor(byBucket as Map<string | number, OeeAccumulator>, bucketStartUtc(new Date(a.actualStart).getTime(), bucket)), fold)
    }

    const byResource = new Map<string, OeeDto | null>()
    for (const rid of resourceIds) byResource.set(rid, byRes.has(rid) ? oeeFromAccumulator(byRes.get(rid)!) : null)
    const oeeByBucket = new Map<number, OeeDto | null>()
    for (const [b, acc] of byBucket) oeeByBucket.set(b, oeeFromAccumulator(acc))
    const leg = (sel: (o: OeeDto) => number): KpiTrendPoint[] =>
      starts.map((x) => {
        const o = oeeByBucket.get(x)
        return { x, y: o ? sel(o) : null }
      })
    return {
      plant: oeeFromAccumulator(total),
      byResource,
      trend: { oee: leg((o) => o.oee), availability: leg((o) => o.availability), performance: leg((o) => o.performance), quality: leg((o) => o.quality) },
      bucket,
      windowStartMs,
      windowEndMs,
    }
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

    const nullCurrent: KpiCurrentValues = { onTime: null, throughput: null, scrap: null, adherence: null }
    const { authoritative } = await this.resolveAuthoritativeActuals(tenantId, plantId, windowStartMs, windowEndMs)
    if (authoritative.length === 0) {
      return { bucket, windowStartMs, windowEndMs, current: nullCurrent, throughput: nullSeries(), scrap: nullSeries(), onTime: nullSeries(), adherence: nullSeries() }
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

    // Window aggregates = the per-bucket accumulators summed (a ratio of sums, NOT a mean of bucket
    // ratios) → the dashboard tile headline, consistent with each KPI's trend by construction.
    const W = { good: 0, planned: 0, scrap: 0, adhereOnTime: 0, adhereTotal: 0, otOnTime: 0, otTotal: 0 }
    for (const a of byBucket.values()) {
      W.good += a.good
      W.planned += a.planned
      W.scrap += a.scrap
      W.adhereOnTime += a.adhereOnTime
      W.adhereTotal += a.adhereTotal
    }
    for (const o of otByBucket.values()) {
      W.otOnTime += o.onTime
      W.otTotal += o.total
    }
    const current: KpiCurrentValues = {
      onTime: W.otTotal > 0 ? W.otOnTime / W.otTotal : null,
      throughput: W.planned > 0 ? W.good / W.planned : null,
      scrap: W.good + W.scrap > 0 ? W.scrap / (W.good + W.scrap) : null,
      adherence: W.adhereTotal > 0 ? W.adhereOnTime / W.adhereTotal : null,
    }

    return {
      bucket,
      windowStartMs,
      windowEndMs,
      current,
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

  /**
   * Assemble the **902 performance dashboard** for a plant — current-value tiles (each with its
   * cascade-resolved threshold status) + trends. Five v1 KPIs, all from the rollup: on-time /
   * throughput / scrap / adherence (current + trend, from {@link computeKpiTrends}) and OEE
   * (current-value-only, A·P·Q from {@link computeHistoricalOee} — the locked seeded snapshot, no
   * trend). Band status comes from the KPI / Metric Policy (so both the measure and the bands are
   * configurable). Cost + churn are version-sequence KPIs (not actuals-windowed) → a later add.
   */
  async computeKpiDashboard(tenantId: string, plantId: string): Promise<KpiDashboardDto> {
    const [trends, oee, policy] = await Promise.all([
      this.computeKpiTrends(tenantId, plantId),
      this.computeOeeFromActuals(tenantId, plantId),
      this.config.resolveKpiPolicy(tenantId, plantId),
    ])
    const band = (key: KpiThresholdKey) => policy.thresholds[key] ?? null
    const tiles: KpiTileDto[] = [
      { key: 'onTime', value: trends.current.onTime, status: kpiStatus(trends.current.onTime, band('onTime')), trend: trends.onTime },
      { key: 'throughput', value: trends.current.throughput, status: kpiStatus(trends.current.throughput, band('throughput')), trend: trends.throughput },
      {
        key: 'oee',
        value: oee.plant?.oee ?? null,
        status: kpiStatus(oee.plant?.oee ?? null, band('oee')),
        trend: oee.trend.oee, // OEE is now actuals-derived → it has an honest combined-OEE trend
        oee: oee.plant ? { availability: oee.plant.availability, performance: oee.plant.performance, quality: oee.plant.quality } : null,
        legTrends: { availability: oee.trend.availability, performance: oee.trend.performance, quality: oee.trend.quality },
      },
      { key: 'scrap', value: trends.current.scrap, status: kpiStatus(trends.current.scrap, band('scrap')), trend: trends.scrap },
      { key: 'adherence', value: trends.current.adherence, status: kpiStatus(trends.current.adherence, band('adherence')), trend: trends.adherence },
    ]
    return { plantId, windowStartMs: trends.windowStartMs, windowEndMs: trends.windowEndMs, bucket: trends.bucket, tiles }
  }
}
