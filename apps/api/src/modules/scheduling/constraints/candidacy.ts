import type { Constraint } from './types'
import { VOCABULARY_VERSION } from './types'
import type { SequencerItem } from '../sequencer'

/**
 * The CANDIDACY mechanism (S1.1 Commit 3) — `PLACEMENT`-scope constraints evaluated per candidate in the
 * selection scan: a violation (`degree > 0`) removes the op from consideration this iteration ("skip"). Each
 * INVOKES the same untouched logic the inline sequencer used (D-S1-5: move the decision, reuse the arithmetic);
 * only the gate decision moves into the registry.
 */

/** CANDIDACY · readiness (C3 precedence) — an op is a placement candidate only once its predecessor is placed.
 *  INVOKES the reused `isReady` closure verbatim (it reads the live `endByLineOp` accumulated during
 *  placement). `degree > 0` → not ready yet → skip this iteration. */
export const readinessCandidacyConstraint = (isReady: (it: SequencerItem) => boolean): Constraint => ({
  id: 'candidacy.readiness',
  scope: 'PLACEMENT',
  mechanism: 'CANDIDACY',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: isReady(m.item) ? 0 : 1 }),
})

/** CANDIDACY · eligibility (AS10) — an op is a candidate only if it has ≥1 eligible resource. The eligible
 *  set is the op's routing-group active members, resolved UPSTREAM into `item.eligibleResourceIds`
 *  (buildBaseContext: `routing_operation.resourceGroupId → members → filter active`) — that data path is
 *  UNCHANGED; only the not-eligible gate decision lives here. `degree > 0` → no eligible resource → skip.
 *  (Every op reaching the sequencer already has ≥1 eligible member — the zero-eligible case is the separate
 *  PRE_GATE hard reject in buildBaseContext, moved in Commit 5 — so this is inert on the demo.) */
export const eligibilityCandidacyConstraint = (): Constraint => ({
  id: 'candidacy.eligibility',
  scope: 'PLACEMENT',
  mechanism: 'CANDIDACY',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: m.item.eligibleResourceIds.length > 0 ? 0 : 1 }),
})
