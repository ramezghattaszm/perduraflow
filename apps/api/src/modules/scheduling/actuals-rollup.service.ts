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
    const MS_PER_DAY = 86_400_000
    const { reportingWindowDays } = await this.config.resolveReporting(tenantId, plantId)
    const windowEndMs = startOfDayUtc(Date.now())
    const windowStartMs = windowEndMs - reportingWindowDays * MS_PER_DAY

    const md = await this.resolveMasterData(tenantId)
    const resourceIds = (await md.listResources(tenantId)).filter((r) => r.plantId === plantId).map((r) => r.id)
    const actuals = await this.learning.listActualsForResourcesInWindow(tenantId, resourceIds, windowStartMs, windowEndMs)
    if (actuals.length === 0) return { authoritative: [], resourceIds, windowStartMs, windowEndMs }

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
    return { authoritative: [...repByOp.values()], resourceIds, windowStartMs, windowEndMs }
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
    const lateByLine = new Map<string, boolean>()
    for (const [line, delivery] of deliveryByLine) {
      const due = dueByLine.get(line)
      lateByLine.set(line, due != null && delivery > due) // no due on record → not judged late
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
    const MS_PER_DAY = 86_400_000
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
}
