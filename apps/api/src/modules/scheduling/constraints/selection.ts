import type { Constraint } from './types'
import { VOCABULARY_VERSION } from './types'
import type { SequencePolicy } from '../sequencer'
import { CHANGEOVER_BONUS_HOURS, EXPEDITE_BONUS_HOURS, MS_PER_HOUR, READY_DEFER_HOURS } from '../sequencer'

/**
 * The SELECTION mechanism (S1.1 Commit 4) — the **sole ordering mechanism**: a **stateful, per-step**
 * composite scorer evaluated for every remaining ready candidate each loop iteration. Each constraint
 * contributes a **signed rank term** (lower total rank wins); the pipeline sums them **in registration order
 * from 0**, reproducing the inline `rank = (requiredDate − origin)/MS_PER_HOUR − bonus − expedite + notReady`
 * bit-for-bit (leading `0 +` is additive identity; the terms fold left-to-right in the same order).
 *
 * **Stateful:** the changeover term reads the resource's **live `currentAttr`** (the last op placed on it,
 * mutated after each placement) and the not-ready term reads its **live `resourceFreeMs`** — so "who's next"
 * depends on what was just placed. This is the SELECTION-scope evaluation surface `(item, resource-state)`,
 * distinct from PLACEMENT's post-selection `(item, model)`. Changeover is a SELECTION rank term ONLY — never
 * a `placeJob`/duration cost (the engine has no per-transition setup; inventing one breaks byte-identical).
 *
 * Registration order is load-bearing (float determinism): `[eddBase, changeover, expedite, notReady]`.
 */

/** SELECTION · EDD base — the due-date position `(requiredDate − origin)/hr`. The base rank term (+). */
export const eddBaseSelectionConstraint = (): Constraint => ({
  id: 'selection.eddBase',
  scope: 'SELECTION',
  mechanism: 'SELECTION',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: 0, contribution: (m.item.requiredDate - m.originMs) / MS_PER_HOUR }),
})

/** SELECTION · changeover rank-bonus (−bonus) — a **forecast** op whose changeover attribute matches the
 *  resource's current campaign (live `currentAttr`) pulls up to `CHANGEOVER_BONUS_HOURS` earlier. Stateful. */
export const changeoverSelectionConstraint = (policy?: SequencePolicy): Constraint => ({
  id: 'selection.changeover',
  scope: 'SELECTION',
  mechanism: 'SELECTION',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => {
    const sameAttr = m.currentAttr != null && m.item.changeoverValue !== null && m.currentAttr === m.item.changeoverValue
    const allowBonus = m.item.firmness === 'forecast' || policy?.changeoverBonusAllFirmness === true
    const bonus = allowBonus && sameAttr ? CHANGEOVER_BONUS_HOURS : 0
    return { degree: 0, contribution: -bonus }
  },
})

/** SELECTION · expedite pull-ahead (−expedite) — the what-if protect-delivery lever front-loads
 *  policy-listed lines. Inert in `solve()` (no policy). */
export const expediteSelectionConstraint = (policy?: SequencePolicy): Constraint => ({
  id: 'selection.expedite',
  scope: 'SELECTION',
  mechanism: 'SELECTION',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: 0, contribution: -(policy?.expediteDemandLineIds?.has(m.item.demandLineId) ? EXPEDITE_BONUS_HOURS : 0) }),
})

/** SELECTION · not-ready deferral (+notReady) — under the `readyFirst` policy, an op not yet material-ready
 *  at the resource's free time is pushed behind ready work. Stateful (reads `resourceFreeMs`). Inert in `solve()`. */
export const notReadySelectionConstraint = (policy?: SequencePolicy): Constraint => ({
  id: 'selection.notReady',
  scope: 'SELECTION',
  mechanism: 'SELECTION',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: 0, contribution: policy?.readyFirst === true && (m.item.earliestStartMs ?? 0) > m.resourceFreeMs ? READY_DEFER_HOURS : 0 }),
})
