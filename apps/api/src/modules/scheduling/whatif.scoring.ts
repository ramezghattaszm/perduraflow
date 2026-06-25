import { type ConstraintBinding, type CostedKpis, OBJECTIVE_DEFAULTS, type ObjectiveWeights, type RationaleFactor } from '@perduraflow/contracts'
import type { Placement } from './sequencer'

const MS_PER_HOUR = 3_600_000

/** Per-resource cost rates (Tier-B), keyed by resource id. */
export interface ResourceRate {
  setupCost: number
  runCostPerHour: number
  overheadPerUnit: number
}

/** Inputs the scorer needs beyond the placements themselves. */
export interface ScoreContext {
  rateByResource: Map<string, ResourceRate>
  /** The current plan's placements (for displacement vs the base). */
  basePlacements: Placement[]
  /** Overtime hours this option adds (cost + the OT factor). */
  overtimeHours: number
  /** The RESOLVED objective weights (config-driven, plant→tenant→global). Omitted → the shipped
   *  `aps-w2` default (the locked-test calibration); production threads the resolved set via context. */
  weights?: ObjectiveWeights
}

/** The scored output for one plan (option). */
export interface ScoredPlan {
  score: number
  kpis: CostedKpis
  factors: RationaleFactor[]
  constraints: ConstraintBinding[]
}

const r4 = (n: number) => Number(n.toFixed(4))
const r2 = (n: number) => Number(n.toFixed(2))

/** Changeover switches across the plan (per resource, in sequence order). */
function countChangeovers(placements: Placement[]): number {
  const byResource = new Map<string, Placement[]>()
  for (const p of placements) {
    const list = byResource.get(p.resourceId) ?? []
    list.push(p)
    byResource.set(p.resourceId, list)
  }
  let switches = 0
  for (const list of byResource.values()) {
    list.sort((a, b) => a.sequencePosition - b.sequencePosition)
    let prev: string | null = null
    for (const p of list) {
      if (prev !== null && p.changeoverValue !== null && p.changeoverValue !== prev) switches += 1
      if (p.changeoverValue !== null) prev = p.changeoverValue
    }
  }
  return switches
}

/** Ops that moved (resource / sequence position) vs the base plan. */
function countDisplaced(placements: Placement[], base: Placement[]): number {
  const baseByKey = new Map(base.map((p) => [`${p.demandLineId}:${p.routingOperationId}`, p]))
  let moved = 0
  for (const p of placements) {
    const b = baseByKey.get(`${p.demandLineId}:${p.routingOperationId}`)
    if (!b || b.resourceId !== p.resourceId || b.sequencePosition !== p.sequencePosition) moved += 1
  }
  return moved
}

/**
 * Score a placed plan into KPIs + a structured rationale (factors + constraints).
 * **Plan-based and deterministic** — no actuals, no randomness. The option score is
 * the sum of the factor contributions (`rawValue · weight`); lower is better.
 * Firm-lateness dominates: the lateness factor counts firm orders only (D13/D23).
 */
export function scorePlan(placements: Placement[], ctx: ScoreContext): ScoredPlan {
  const w = ctx.weights ?? OBJECTIVE_DEFAULTS
  let firmLateHours = 0
  let earlyHours = 0
  let cost = 0
  let costedQty = 0
  let totalQty = 0
  const lateLines = new Set<string>()
  const onTime = placements.filter((p) => !p.atRisk).length

  for (const p of placements) {
    totalQty += p.qty
    const lateMs = p.plannedEndMs - p.requiredDateMs
    if (lateMs > 0) {
      lateLines.add(p.demandLineId)
      if (p.firmness === 'firm') firmLateHours += lateMs / MS_PER_HOUR
    } else {
      earlyHours += -lateMs / MS_PER_HOUR
    }
    const rate = ctx.rateByResource.get(p.resourceId)
    if (rate && p.qty > 0) {
      const runMin = p.setupTime + p.cycleTime * p.qty
      cost += rate.setupCost + rate.runCostPerHour * (runMin / 60) + rate.overheadPerUnit * p.qty
      costedQty += p.qty
    }
  }

  const changeovers = countChangeovers(placements)
  const displaced = countDisplaced(placements, ctx.basePlacements)
  const otHours = ctx.overtimeHours
  // OT premium adds to cost (labour over the affected hours, billed at run rate proxy).
  const otCost = otHours * (avgRunRate(ctx.rateByResource) ?? 0)
  const costPerUnit = costedQty > 0 ? r2((cost + otCost) / costedQty) : null

  const factors: RationaleFactor[] = [
    factor('lateness', 'h', r2(firmLateHours), w.lateness, 'whatif.factor.lateness', {
      hours: r2(firmLateHours),
      orders: lateLines.size,
    }),
    factor('changeover', '', changeovers, w.changeover, 'whatif.factor.changeover', { count: changeovers }),
    factor('overtime', 'h', r2(otHours), w.overtime, 'whatif.factor.overtime', { hours: r2(otHours) }),
    factor('inventory', 'h', r2(earlyHours), w.inventory, 'whatif.factor.inventory', { hours: r2(earlyHours) }),
    factor('displacement', '', displaced, w.displacement, 'whatif.factor.displacement', { count: displaced }),
    // Cost (C6): per-unit economics in the objective. rawValue = costPerUnit, with a non-null
    // guard — an uncosted plan (no rated resource → costPerUnit null) contributes 0 (cost-neutral),
    // never NaN; the seed rates every resource, so this only fires on misconfigured data. Weight 4
    // keeps cost a real discriminator while staying far below lateness (firm-lateness dominance).
    factor('cost', '', costPerUnit ?? 0, w.cost, 'whatif.factor.cost', { cost: costPerUnit ?? 0 }),
  ]
  const score = r4(factors.reduce((s, f) => s + f.contribution, 0))

  const constraints: ConstraintBinding[] = [
    {
      key: 'feasibility',
      labelKey: 'whatif.constraint.feasibility',
      type: 'hard',
      binding: false,
      slack: null,
      detailKey: 'whatif.constraint.feasibility.ok',
      detailParams: { ops: placements.length },
    },
    {
      key: 'firm_delivery',
      labelKey: 'whatif.constraint.firmDelivery',
      type: 'soft',
      binding: firmLateHours > 0,
      slack: firmLateHours > 0 ? 0 : null,
      detailKey: firmLateHours > 0 ? 'whatif.constraint.firmDelivery.late' : 'whatif.constraint.firmDelivery.met',
      detailParams: { hours: r2(firmLateHours) },
    },
    {
      key: 'changeover_grouping',
      labelKey: 'whatif.constraint.changeover',
      type: 'soft',
      binding: false,
      slack: changeovers,
      detailKey: 'whatif.constraint.changeover.count',
      detailParams: { count: changeovers },
    },
  ]

  const kpis: CostedKpis = {
    otif: placements.length > 0 ? r4(onTime / placements.length) : 1,
    costPerUnit,
    oee: null,
    lateOrders: lateLines.size,
    // The scored quantity (firm-lateness dominance) — surfaced as the headline late metric so the
    // recommendation is legible (fewer total breach-hours wins, even with more late orders).
    firmLateHours: r2(firmLateHours),
    throughput: totalQty,
    churn: ctx.basePlacements.length > 0 ? r4(displaced / placements.length) : null,
  }

  return { score, kpis, factors, constraints }
}

function avgRunRate(rates: Map<string, ResourceRate>): number | null {
  const vals = [...rates.values()].map((r) => r.runCostPerHour).filter((v) => v > 0)
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null
}

function direction(contribution: number): RationaleFactor['direction'] {
  if (contribution > 0) return 'worsens'
  if (contribution < 0) return 'improves'
  return 'neutral'
}

function factor(
  key: RationaleFactor['key'],
  unit: string,
  rawValue: number,
  weight: number,
  detailKey: string,
  detailParams: Record<string, string | number>,
): RationaleFactor {
  const contribution = r4(rawValue * weight)
  return {
    key,
    labelKey: `whatif.factorLabel.${key}`,
    rawValue,
    unit,
    weight,
    contribution,
    // Higher cost is "worse" for cost-like factors; all our factors are penalties,
    // so a positive contribution worsens the score. Zero = neutral.
    direction: direction(contribution),
    detailKey,
    detailParams,
  }
}
