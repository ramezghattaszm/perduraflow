import type { Constraint } from './types'
import { VOCABULARY_VERSION } from './types'

/**
 * The PRE_GATE mechanism (S1.1 Commit 5) — a service-level hard gate evaluated BEFORE the placement loop
 * (in buildBaseContext): a violation aborts the whole solve (SCHEDULE_INFEASIBLE), so the op never reaches
 * the sequencer. Distinct from CANDIDACY (a per-iteration skip inside the loop). `scope` is `PLACEMENT`
 * (the pre-loop gate); `degree > 0` = reject.
 */

/**
 * PRE_GATE · eligibility (D4/AS10) — an op with NO eligible active resource hard-rejects the solve. Reads
 * the SAME predicate as the CANDIDACY eligibility term (`item.eligibleResourceIds.length`), so the two are
 * **consistent by construction**: this PRE_GATE fires first (before the loop) and aborts, which is exactly
 * what makes the CANDIDACY eligibility skip inert — the same ops are handled (zero-eligible), no gap
 * (nothing zero-eligible slips past the gate into the loop) and no double-handling (the gate aborts before
 * CANDIDACY runs). The group→members resolution stays in buildBaseContext; only the reject decision is here.
 */
export const eligibilityPreGateConstraint = (): Constraint => ({
  id: 'pregate.eligibility',
  scope: 'PLACEMENT',
  mechanism: 'PRE_GATE',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: m.item.eligibleResourceIds.length === 0 ? 1 : 0 }),
})
