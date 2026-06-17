import { Injectable } from '@nestjs/common'
import type { BaselineSource, CostedKpis, PlanComparisonDto } from '@perduraflow/contracts'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService } from './scheduling.service'
import { sequence, type SequencerItem } from './sequencer'
import { scorePlan, type ResourceRate } from './whatif.scoring'

/**
 * Plan-comparison primitive + the two baseline arms (phase 5, D57). It snapshots the
 * live plan's KPIs and diffs them against a typed baseline:
 *  - `frozen_engine_snapshot` — **the same engine** with the learning + stability
 *    layers off and **naive policies** (pure EDD, no changeover grouping, std
 *    times). The gap is "the lift our intelligence adds" — NOT "vs your manual
 *    process". Computed on demand (deterministic; no stored snapshot needed).
 *  - `measured_historical` — aggregated from seeded historical-outcome rows; shows
 *    the honest **empty state** when a scope has no rows. Never fabricated.
 */
@Injectable()
export class PlanComparisonService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly scheduling: SchedulingService,
  ) {}

  /** Live plan vs the requested baseline arm (empty-state when a baseline is absent). */
  async compare(tenantId: string, plantId: string, source: BaselineSource, resourceId?: string): Promise<PlanComparisonDto> {
    const ctx = await this.scheduling.buildBaseContext(tenantId, plantId)
    const versionId = (await this.repo.findCommittedVersion(tenantId, plantId))?.id ?? null
    const rateByResource = this.rates(ctx.resourceById)

    // No demand at all → nothing to compare; honest empty state for both arms.
    if (ctx.infeasibleReason || ctx.items.length === 0) {
      return { source, emptyState: true, plantId, scheduleVersionId: versionId, live: null, baseline: null, labelKey: labelFor(source) }
    }

    const liveItems = resourceId ? ctx.items.filter((i) => i.eligibleResourceIds.includes(resourceId)) : ctx.items
    const overlay = await this.scheduling.buildLearnedOverlay(tenantId, ctx.items)
    const live = scorePlan(sequence(liveItems, overlay).placements, { rateByResource, basePlacements: [], overtimeHours: 0 }).kpis

    if (source === 'frozen_engine_snapshot') {
      // Naive-frozen: std times (no overlay) + no changeover awareness (pure EDD).
      const naiveItems = stripChangeover(liveItems)
      const baseline = scorePlan(sequence(naiveItems).placements, { rateByResource, basePlacements: [], overtimeHours: 0 }).kpis
      return { source, emptyState: false, plantId, scheduleVersionId: versionId, live, baseline, labelKey: labelFor(source) }
    }

    // measured_historical — aggregate seeded rows; empty-state when none.
    const rows = await this.repo.listHistoricalOutcomes(tenantId, plantId, resourceId)
    if (rows.length === 0) {
      return { source, emptyState: true, plantId, scheduleVersionId: versionId, live, baseline: null, labelKey: labelFor(source) }
    }
    const baseline = aggregate(rows)
    return { source, emptyState: false, plantId, scheduleVersionId: versionId, live, baseline, labelKey: labelFor(source) }
  }

  private rates(resourceById: Map<string, { setupCost: number | null; runCostPerHour: number | null; overheadPerUnit: number | null }>): Map<string, ResourceRate> {
    const out = new Map<string, ResourceRate>()
    for (const [id, r] of resourceById) {
      out.set(id, { setupCost: r.setupCost ?? 0, runCostPerHour: r.runCostPerHour ?? 0, overheadPerUnit: r.overheadPerUnit ?? 0 })
    }
    return out
  }
}

function labelFor(source: BaselineSource): string {
  return source === 'frozen_engine_snapshot' ? 'baseline.frozenLabel' : 'baseline.historicalLabel'
}

function stripChangeover(items: SequencerItem[]): SequencerItem[] {
  return items.map((i) => ({ ...i, changeoverValue: null }))
}

const r2 = (n: number) => Number(n.toFixed(2))
const r4 = (n: number) => Number(n.toFixed(4))

interface HistoricalRow {
  otif: number
  costPerUnit: number | null
  oeeAvailability: number | null
  oeePerformance: number | null
  oeeQuality: number | null
  lateOrders: number
  throughput: number | null
}

/** Average the historical rows into a single baseline KPI bundle (computed, not stored output). */
function aggregate(rows: HistoricalRow[]): CostedKpis {
  const n = rows.length
  const avg = (vals: (number | null)[]): number | null => {
    const present = vals.filter((v): v is number => v != null)
    return present.length > 0 ? present.reduce((s, v) => s + v, 0) / present.length : null
  }
  const a = avg(rows.map((r) => r.oeeAvailability))
  const p = avg(rows.map((r) => r.oeePerformance))
  const q = avg(rows.map((r) => r.oeeQuality))
  const cpu = avg(rows.map((r) => r.costPerUnit))
  return {
    otif: r4(rows.reduce((s, r) => s + r.otif, 0) / n),
    costPerUnit: cpu != null ? r2(cpu) : null,
    // Aggregate A·P·Q honestly from recorded components; the blended OEE is their product.
    oee: a != null && p != null && q != null ? { availability: a, performance: p, quality: q, oee: r4(a * p * q) } : null,
    lateOrders: Math.round(rows.reduce((s, r) => s + r.lateOrders, 0) / n),
    throughput: avg(rows.map((r) => r.throughput)),
    churn: null,
  }
}
