import type { Constraint } from './types'
import { VOCABULARY_VERSION } from './types'

/**
 * The FEASIBILITY mechanism (S1.1 Commit 5) — a `PLACEMENT`-scope constraint evaluated AFTER `placeJob`:
 * `placeJob` returning `null` (the op is longer than any working segment and can't split) is an
 * infeasibility. **Degrade form only** (this commit): the placement is left as-is — the sequencer's
 * contiguous-fallback arithmetic (`startMs = placed?.startMs ?? floor`, `placedFeasible = placed !== null`,
 * `atRisk |= placed === null`) is INVOKED unchanged (D-S1-5). The verdict is recorded here so S1.2 can give
 * it teeth (the veto-and-reselect form) without touching the arithmetic. `degree > 0` = infeasible.
 */
export const placementFeasibilityConstraint = (): Constraint => ({
  id: 'feasibility.placement',
  scope: 'PLACEMENT',
  mechanism: 'FEASIBILITY',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: m.placedFeasible === false ? 1 : 0 }),
})
