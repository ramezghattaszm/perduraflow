import { type ConstraintBinding, type CostedKpis, OBJECTIVE_DEFAULTS, OBJECTIVE_WEIGHT_KEYS, type ObjectiveWeights, type RationaleFactor } from '@perduraflow/contracts'
import type { Placement } from './sequencer'

const MS_PER_HOUR = 3_600_000

/**
 * Firm-lateness equivalent of ONE window-overflow-infeasible firm op (an op longer than any working
 * segment that can't split → `placedFeasible=false`). A large fixed deterministic sentinel (mirrors
 * `EXPEDITE_BONUS_HOURS`): folded into the lateness factor so an op that CAN'T run as scheduled is the
 * worst firm-delivery outcome — it dominates any realistic late-hours total and rides weight 10, so
 * firm-lateness dominance is preserved with no weight/guard change. NOT shown anywhere: the honest
 * `firmLateHours` KPI excludes it; the legible signal is the separate `infeasibleFirmOps` count.
 */
export const INFEASIBLE_LATENESS_HOURS = 100_000

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
  /**
   * S1.3 — objective factors contributed by SOFT-mode registered constraints (via the mode→behavior bridge),
   * appended AFTER the six built-ins so the built-in fold order is unchanged. **Empty/absent in S1.3** (no
   * constraint carries a mode) → the factor list + score are byte-identical.
   */
  softFactors?: RationaleFactor[]
  /**
   * S1.3 — the constraint keys currently HARD-enforced (via the bridge). Makes a hard `ConstraintBinding`'s
   * `binding` an HONEST verdict instead of the hardcoded `false`. **Empty/absent in S1.3** → every hard
   * binding stays `false`, byte-identical.
   */
  hardBoundKeys?: ReadonlySet<string>
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
  let infeasibleFirmOps = 0
  let cost = 0
  let costedQty = 0
  let totalQty = 0
  const lateLines = new Set<string>()
  const onTime = placements.filter((p) => !p.atRisk).length

  for (const p of placements) {
    totalQty += p.qty
    // Window-overflow infeasibility (C-late): a firm op that can't fit any working segment CAN'T run as
    // scheduled — its recorded end is a fictional contiguous fallback. Count it (firm only, matching the
    // lateness scope); folded into the lateness factor below as the worst firm-delivery outcome.
    if (!p.placedFeasible && p.firmness === 'firm') infeasibleFirmOps += 1
    const lateMs = p.plannedEndMs - p.requiredDateMs
    if (lateMs > 0) {
      lateLines.add(p.demandLineId)
      if (p.firmness === 'firm') firmLateHours += lateMs / MS_PER_HOUR
    } else {
      earlyHours += -lateMs / MS_PER_HOUR
    }
    const rate = ctx.rateByResource.get(p.resourceId)
    if (p.qty > 0 && (rate || p.operatorLaborRate != null)) {
      const runMin = p.setupTime + p.cycleTime * p.qty
      if (rate) cost += rate.setupCost + rate.runCostPerHour * (runMin / 60) + rate.overheadPerUnit * p.qty
      // Operator LABOR ($/hr × the op's working hours): folds the cost of WHO ran the op into the same
      // per-unit cost objective. A faster operator shortens runMin (less labor time) but a pricier one
      // bills more per hour — so the genuine labor trade-off of an operator swap is now scored, not free.
      // null laborRate (no operator) → 0 (cost-neutral); never NaN.
      if (p.operatorLaborRate != null) cost += p.operatorLaborRate * (runMin / 60)
      costedQty += p.qty
    }
  }

  const changeovers = countChangeovers(placements)
  const displaced = countDisplaced(placements, ctx.basePlacements)
  const otHours = ctx.overtimeHours
  // OT premium adds to cost (labour over the affected hours, billed at run rate proxy).
  const otCost = otHours * (avgRunRate(ctx.rateByResource) ?? 0)
  const costPerUnit = costedQty > 0 ? r2((cost + otCost) / costedQty) : null

  // Lateness factor RAW = honest due-late hours + a large sentinel per infeasible firm op (folded in so
  // an op that can't run as scheduled is the worst firm-delivery outcome, riding weight 10 → dominance
  // preserved, no weight/guard change). The `firmLateHours` KPI below stays the HONEST due-late figure
  // (never the sentinel); `infeasibleFirmOps` is the legible count. Inert when no infeasible firm op
  // (raw === firmLateHours) → feasible-plan scores are byte-identical to before. detailParams stay honest.
  const latenessRaw = r2(firmLateHours + infeasibleFirmOps * INFEASIBLE_LATENESS_HOURS)
  // Option B (D-S1-6): the factor list is DERIVED from the objective registry (`OBJECTIVE_WEIGHT_KEYS`), not a
  // hardcoded array — so a registered constraint (S2/S3) can contribute a factor under its own key on the same
  // mechanism. The six built-ins provide their rawValue/detailParams here, keyed; the registry ORDER
  // (lateness, changeover, overtime, inventory, displacement, cost) is preserved, so the factors array + the
  // `reduce` fold sum in the EXACT same sequence as the prior hardcoded array → byte-identical score (float
  // addition is not associative, so the order is load-bearing).
  const builtinFactors: Record<string, () => RationaleFactor> = {
    lateness: () =>
      factor('lateness', 'h', latenessRaw, w.lateness, 'whatif.factor.lateness', {
        hours: r2(firmLateHours),
        orders: lateLines.size,
        infeasible: infeasibleFirmOps,
      }),
    changeover: () => factor('changeover', '', changeovers, w.changeover, 'whatif.factor.changeover', { count: changeovers }),
    overtime: () => factor('overtime', 'h', r2(otHours), w.overtime, 'whatif.factor.overtime', { hours: r2(otHours) }),
    inventory: () => factor('inventory', 'h', r2(earlyHours), w.inventory, 'whatif.factor.inventory', { hours: r2(earlyHours) }),
    displacement: () => factor('displacement', '', displaced, w.displacement, 'whatif.factor.displacement', { count: displaced }),
    // Cost (C6): per-unit economics in the objective — resource cost (setup/run/overhead) + OT premium
    // + operator LABOR ($/hr × working hours). rawValue = costPerUnit, with a non-null guard: an uncosted
    // plan (no rated resource AND no operator → costPerUnit null) contributes 0 (cost-neutral), never NaN;
    // the seed rates every resource, so this only fires on misconfigured data. Weight 4 keeps cost a real
    // discriminator (the levers compare on $) while staying far below lateness (firm-lateness dominance).
    cost: () => factor('cost', '', costPerUnit ?? 0, w.cost, 'whatif.factor.cost', { cost: costPerUnit ?? 0 }),
  }
  // The six built-ins in registry/fold order, then any SOFT-constraint factors from the bridge (S1.3) —
  // empty in S1.3, so the fold is byte-identical.
  const factors: RationaleFactor[] = [...OBJECTIVE_WEIGHT_KEYS.map((k) => builtinFactors[k]!()), ...(ctx.softFactors ?? [])]
  const score = r4(factors.reduce((s, f) => s + f.contribution, 0))

  const constraints: ConstraintBinding[] = [
    {
      key: 'feasibility',
      labelKey: 'whatif.constraint.feasibility',
      type: 'hard',
      // S1.3: an HONEST verdict — bound iff feasibility is hard-enforced via the bridge (empty in S1.3 → false).
      binding: ctx.hardBoundKeys?.has('feasibility') ?? false,
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
    // recommendation is legible (fewer total breach-hours wins, even with more late orders). HONEST
    // due-lateness only — the infeasibility sentinel never appears here (it's in `infeasibleFirmOps`).
    firmLateHours: r2(firmLateHours),
    infeasibleFirmOps,
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
