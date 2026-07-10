import type { Constraint } from './types'
import { VOCABULARY_VERSION } from './types'
import type { SequencerItem } from '../sequencer'

/**
 * The FLOOR mechanism (S1.1 Commit 2) — `PLACEMENT`-scope constraints that contribute a start-time (or run-
 * quantity) floor. Each **invokes the same untouched arithmetic the inline sequencer used** (D-S1-5: move the
 * decision, reuse the arithmetic) — the millisecond/quantity math is verbatim; only the decision to fold it
 * into the floor moved here. The pipeline's floor tiers fold these contributions with `Math.max` — exactly
 * the composition the sequencer computed inline.
 */

/** FLOOR · material (D36) — the op can't start before its consumed buy-components are available. Arithmetic:
 *  `item.earliestStartMs ?? 0` (resolved upstream from the §4.8 material-availability input). */
export const materialFloorConstraint = (): Constraint => ({
  id: 'floor.material',
  scope: 'PLACEMENT',
  mechanism: 'FLOOR',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: 0, contribution: m.item.earliestStartMs ?? 0 }),
})

/** FLOOR · order-release — an order isn't worked before its release day. Arithmetic: `item.releaseFloorMs ?? 0`. */
export const releaseFloorConstraint = (): Constraint => ({
  id: 'floor.release',
  scope: 'PLACEMENT',
  mechanism: 'FLOOR',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: 0, contribution: m.item.releaseFloorMs ?? 0 }),
})

/** FLOOR · precedence (C3) — an op can't start before its predecessor's end. INVOKES the reused
 *  `predecessorEnd` closure verbatim (it reads the live `endByLineOp` accumulated during placement); the
 *  arithmetic is untouched — only the fold-into-floor decision moved here. */
export const precedenceFloorConstraint = (predecessorEnd: (it: SequencerItem) => number): Constraint => ({
  id: 'floor.precedence',
  scope: 'PLACEMENT',
  mechanism: 'FLOOR',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: 0, contribution: predecessorEnd(m.item) }),
})

/** FLOOR · minimum batch (C4) — a **quantity** floor: the op runs to at least the resource type's minimum
 *  batch. Arithmetic: `minBatchByResource.get(resourceId) ?? 0` (folded into effRunQty via the pipeline's
 *  quantity-floor tier as `max(demandQty, minBatch)`). */
export const minBatchFloorConstraint = (minBatchByResource: Map<string, number>): Constraint => ({
  id: 'floor.minBatch',
  scope: 'PLACEMENT',
  mechanism: 'FLOOR',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: 0, contribution: minBatchByResource.get(m.resourceId) ?? 0 }),
})
