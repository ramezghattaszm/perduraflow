import type { BindingKind, LatenessChainDto, LatenessHop, LatenessRoot, ResourceDowntimeKind } from '@perduraflow/contracts'

/**
 * Causal lateness attribution (D-late) — **pure + deterministic**. Given a version's operations (each
 * carrying the engine's recorded binding floor: see {@link BindingKind}), trace a late order through
 * its computed blockers to a ROOT cause. Every hop is a stored engine fact (which floor set the start),
 * never inferred — so the chain is grounded and the Copilot can narrate it verbatim.
 *
 * Termination: `predecessor`/`resource` hops point at a blocking op and recurse; the other kinds are
 * roots and stop. Each hop moves to an op that ended earlier, so the walk is acyclic by construction —
 * but a visited-set + {@link MAX_DEPTH} cap guard against any pathological revisit and flag `truncated`
 * rather than silently dropping the tail.
 */

/** Max hops before the chain is truncated (belt-and-suspenders; real chains are short). */
export const MAX_DEPTH = 8

/** The minimal op shape the walk needs (a subset of the persisted scheduled operation). */
export interface LatenessOp {
  demandLineId: string
  opSeq: number
  resourceId: string
  partId: string
  atRisk: boolean
  bindingKind: BindingKind | null
  bindingBlockerDemandLineId: string | null
  bindingBlockerOpSeq: number | null
  /** When `bindingKind` is `resource_downtime`, the closure window that delayed the start. */
  bindingDowntimeId: string | null
  /** When `bindingKind` is `operator`, the slow operator who inflated this op's run. */
  bindingOperatorId: string | null
}

/** Lookups resolved by the caller (kept out of the pure walk so it stays deterministic + testable). */
export interface LatenessLookups {
  resourceName: (resourceId: string) => string
  partNo: (partId: string) => string
  /** The binding gate component's part-no for a part (latest-arriving requirement), or null. */
  materialComponent: (partId: string) => string | null
  /** The downtime window (kind + reason) for a `resource_downtime` binding, or null. */
  downtime: (downtimeId: string | null) => { kind: ResourceDowntimeKind; reason: string | null } | null
  /** The operator (name + factor) for an `operator` binding, or null. */
  operator: (operatorId: string | null) => { name: string; performanceFactor: number } | null
}

const keyOf = (demandLineId: string, opSeq: number): string => `${demandLineId}:${opSeq}`

/** Map a terminal (root) binding to a {@link LatenessRoot}, using the terminal op's own at-risk state. */
function rootOf(kind: BindingKind, op: LatenessOp): LatenessRoot {
  if (kind === 'material') return 'material'
  if (kind === 'resource_downtime') return 'resource_downtime'
  if (kind === 'operator') return 'operator'
  if (kind === 'working_window') return 'working_window'
  // release / origin: the op started as early as its day / the horizon allowed. If the op is itself
  // late, its DUE precedes the earliest feasible start (due_before_start); if it's on-time, the chain
  // bottomed out at firm work saturating the resource (capacity).
  return op.atRisk ? 'due_before_start' : 'capacity'
}

function hopOf(
  op: LatenessOp,
  kind: LatenessHop['kind'],
  detail: string | null,
  lk: LatenessLookups,
  downtimeKind: ResourceDowntimeKind | null = null,
  operatorPct: number | null = null,
): LatenessHop {
  return {
    demandLineId: op.demandLineId,
    opSeq: op.opSeq,
    resourceId: op.resourceId,
    resourceName: lk.resourceName(op.resourceId),
    partNo: lk.partNo(op.partId),
    kind,
    detail,
    downtimeKind,
    operatorPct,
  }
}

/**
 * Build the causal chain for one (late) op. Returns null when the op carries no binding (legacy /
 * un-resolved). The first hop is the op itself; the last carries the root.
 */
export function buildLatenessChain(
  start: LatenessOp,
  opByKey: Map<string, LatenessOp>,
  lk: LatenessLookups,
): LatenessChainDto | null {
  if (start.bindingKind == null) return null
  const hops: LatenessHop[] = []
  const visited = new Set<string>()
  let cur: LatenessOp | undefined = start
  let root: LatenessRoot = 'capacity'
  let truncated = false

  while (cur) {
    const k = keyOf(cur.demandLineId, cur.opSeq)
    if (visited.has(k) || hops.length >= MAX_DEPTH) {
      truncated = true
      break
    }
    visited.add(k)
    const kind = cur.bindingKind
    if (kind === 'predecessor' || kind === 'resource') {
      hops.push(hopOf(cur, kind, null, lk))
      const blockerKey: string | null =
        cur.bindingBlockerDemandLineId != null && cur.bindingBlockerOpSeq != null
          ? keyOf(cur.bindingBlockerDemandLineId, cur.bindingBlockerOpSeq)
          : null
      const next: LatenessOp | undefined = blockerKey ? opByKey.get(blockerKey) : undefined
      if (!next) {
        // Blocker not found (or no ref) — treat the contention as a capacity root, don't fabricate.
        root = 'capacity'
        truncated = true
        break
      }
      cur = next
    } else {
      // kind is null here is impossible (start guarded; blockers reached only via resource/predecessor
      // which set a non-null kind on the next op… but the next op could itself be a root kind).
      const r = rootOf(kind ?? 'origin', cur)
      // Root specifics, grounded in stored facts: the material gate's component, the downtime window's
      // reason + kind (line-down vs maintenance), or the slow operator's name + % — never inferred.
      const dt = r === 'resource_downtime' ? lk.downtime(cur.bindingDowntimeId) : null
      const opr = r === 'operator' ? lk.operator(cur.bindingOperatorId) : null
      const detail = r === 'material' ? lk.materialComponent(cur.partId) : r === 'operator' ? (opr?.name ?? null) : (dt?.reason ?? null)
      hops.push(hopOf(cur, r, detail, lk, dt?.kind ?? null, opr ? Math.round(opr.performanceFactor * 100) : null))
      root = r
      cur = undefined
    }
  }

  return { hops, root, truncated }
}

/**
 * Build chains for every AT-RISK op in a version → keyed by `demandLineId:opSeq`. Non-at-risk ops are
 * indexed (so chains can pass through them) but get no chain of their own.
 */
export function buildLatenessChains(ops: LatenessOp[], lk: LatenessLookups): Map<string, LatenessChainDto> {
  const opByKey = new Map(ops.map((o) => [keyOf(o.demandLineId, o.opSeq), o]))
  const out = new Map<string, LatenessChainDto>()
  for (const o of ops) {
    if (!o.atRisk) continue
    const chain = buildLatenessChain(o, opByKey, lk)
    if (chain) out.set(keyOf(o.demandLineId, o.opSeq), chain)
  }
  return out
}
