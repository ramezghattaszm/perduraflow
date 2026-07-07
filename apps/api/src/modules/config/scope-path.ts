import type { ConfigLevel } from '@perduraflow/contracts'

/**
 * The realized scope ladder, broadest → narrowest. `global` is the in-code descriptor default (never a
 * stored row); `tenant`/`plant` are stored overrides. **Ladder-driven** so a future rung (e.g. `line`) is
 * an additive entry here + a fetch in {@link walkScopePath} — never a reshape of any fold. Only the rungs
 * with a real containment entity are realized today (platform doc §3.1/§3.4): `global→tenant→plant`.
 */
export const SCOPE_LADDER = ['global', 'tenant', 'plant'] as const

/** One rung of a resolved scope path: the level and its stored row (undefined = no override / the global floor). */
export interface ScopeLevelRow<R> {
  level: ConfigLevel
  row: R | undefined
}

/** Fetches the stored row for a scope level (`tenant`→scopeId=tenantId, `plant`→scopeId=plantId). */
export type ScopeRowFetch<R> = (level: 'tenant' | 'plant', scopeId: string) => Promise<R | undefined>

/**
 * THE shared scope-path walker (Commit-1 extraction, generalized for Commit-2 reference sets). Walks the
 * ladder for a context and returns the ordered level rows (broadest → narrowest), driven by `levels` (the
 * rungs a consumer declares — config groups walk the full ladder; a reference set walks its declared
 * depth). `global` carries no stored row (the descriptor default is the floor); `plant` is only walked when
 * a `plantId` is in context. A fold (scalar or membership) plugs on top of this one walk — the walker is
 * content-kind-agnostic (the `fetch` closure supplies the rows from whichever table).
 */
export async function walkScopePath<R>(
  tenantId: string,
  plantId: string | undefined,
  levels: readonly ConfigLevel[],
  fetch: ScopeRowFetch<R>,
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
    }
  }
  return path
}
