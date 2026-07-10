import type { ConfigLevel } from '@perduraflow/contracts'

/**
 * The realized scope ladder, broadest → narrowest. `global` is the in-code descriptor default (never a
 * stored row); `tenant`/`plant`/`line` are stored overrides. **Ladder-driven** so a rung is an additive
 * entry here + a fetch in {@link walkScopePath} — never a reshape of any fold. `line` is REALIZED (S0b —
 * `org.line` exists as single-parent containment) but resolves only for a consumer that declares `line`
 * depth AND supplies a `lineId`; nothing declares it in S0 (that is S1). Deeper rungs (`work_center`, …)
 * await their containment entity (platform doc §3.4).
 */
export const SCOPE_LADDER = ['global', 'tenant', 'plant', 'line'] as const

/** One rung of a resolved scope path: the level and its stored row (undefined = no override / the global floor). */
export interface ScopeLevelRow<R> {
  level: ConfigLevel
  row: R | undefined
}

/** Fetches the stored row for a scope level (`tenant`→tenantId, `plant`→plantId, `line`→lineId). */
export type ScopeRowFetch<R> = (level: 'tenant' | 'plant' | 'line', scopeId: string) => Promise<R | undefined>

/**
 * THE shared scope-path walker (Commit-1 extraction, generalized for Commit-2 reference sets; S0b adds the
 * `line` rung). Walks the ladder for a context and returns the ordered level rows (broadest → narrowest),
 * driven by `levels` (the rungs a consumer declares — config groups walk the full ladder; a reference set
 * walks its declared depth). `global` carries no stored row (the descriptor default is the floor); `plant`
 * is walked only when a `plantId` is in context, `line` only when a `lineId` is. A fold (scalar or
 * membership) plugs on top of this one walk — the walker is content-kind-agnostic (`fetch` supplies rows).
 *
 * **Byte-identical (S0b):** with no `lineId` in context, the `line` branch is skipped, so the path is the
 * exact pre-S0b `global→tenant→plant` sequence — a `lineId` threaded but absent changes nothing.
 */
export async function walkScopePath<R>(
  tenantId: string,
  plantId: string | undefined,
  levels: readonly ConfigLevel[],
  fetch: ScopeRowFetch<R>,
  lineId?: string,
): Promise<ScopeLevelRow<R>[]> {
  const path: ScopeLevelRow<R>[] = []
  for (const level of SCOPE_LADDER) {
    if (!levels.includes(level)) continue
    if (level === 'global') {
      path.push({ level, row: undefined }) // the in-code descriptor default — never stored
    } else if (level === 'tenant') {
      path.push({ level, row: await fetch('tenant', tenantId) })
    } else if (level === 'plant' && plantId) {
      path.push({ level, row: await fetch('plant', plantId) })
    } else if (level === 'line' && lineId) {
      path.push({ level, row: await fetch('line', lineId) })
    }
  }
  return path
}
