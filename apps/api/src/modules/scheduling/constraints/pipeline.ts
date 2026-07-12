import type { Constraint, ScheduleModel } from './types'
import type { SequencerItem } from '../sequencer'

/** The PLACEMENT-tier constraint sets, grouped by phase (evaluated in the declared phase order). */
export interface PlacementConstraints {
  preGate?: Constraint[]
  /** FLOOR · start-time — folded into the op's start floor (`Math.max`). */
  floor?: Constraint[]
  /** FLOOR · quantity — folded into the op's run quantity (`Math.max`); same mechanism, quantity dimension. */
  quantityFloor?: Constraint[]
  candidacy?: Constraint[]
  /**
   * PLACEMENT · CANDIDACY (resource-aware, pre-place) — the S1.2 veto point evaluated AFTER resource
   * assignment (distinct from {@link candidacy}, which runs pre-assignment with `resourceId=''`). A registered
   * constraint with `degree > 0` = "not this op on this resource this step" (D28-shaped). **Empty in S1.2 →
   * {@link ConstraintPipeline.preplaceVeto} always returns false → the reselect branch is dead (inert).**
   */
  preplaceVeto?: Constraint[]
  feasibility?: Constraint[]
  /**
   * PLACEMENT · FEASIBILITY (reject form) — the S1.2 post-place veto. Distinct from {@link feasibility} (the
   * degrade form, which records the verdict but leaves the placement): a registered constraint with
   * `degree > 0` = **reject** the placement → reselect (D9-shaped). **Empty in S1.2 →
   * {@link ConstraintPipeline.feasibilityRejects} always returns false → no placement is ever rejected (inert).**
   */
  feasibilityReject?: Constraint[]
}

/**
 * The two-scope constraint pipeline (S1.1) — the registry the placement loop routes through.
 *
 * **SELECTION scope** ({@link selectionScore}) is the stateful per-step composite scorer, evaluated for
 * every remaining ready candidate each iteration — the sole ordering mechanism. **PLACEMENT scope** evaluates
 * PER JOB post-selection in the declared phase order `PRE_GATE → CANDIDACY → FLOOR → place → FEASIBILITY`.
 * The phase order is part of the determinism contract — evaluating a FLOOR after CANDIDACY (or reordering the
 * stateful SELECTION scan) would change *when* it evaluates and break byte-identicalness.
 * There is no ORDERING scope — the DB input order is proven inert, so {@link order} is an identity no-op.
 *
 * S1.1 extracted every mechanism into this registry byte-identical (Commits 1–5): the loop routes THROUGH the
 * pipeline and computes exactly as the prior inline logic. When a scope/phase has constraints, its caller
 * passes the {@link ScheduleModel}; an empty phase returns the delegate unchanged.
 */
export class ConstraintPipeline {
  constructor(
    private readonly ordering: Constraint[] = [],
    private readonly placement: PlacementConstraints = {},
    private readonly selection: Constraint[] = [],
  ) {}

  /**
   * Input-order seam — returns `items` unchanged. There is **no ORDERING scope**: the DB input order is
   * proven inert (the reverse-order diagnostic left the plan byte-identical, because the SELECTION min-scan
   * is order-invariant under the total-order tie-break). Kept as an inert identity no-op; NOT a mechanism.
   */
  order(items: SequencerItem[]): SequencerItem[] {
    return items
  }

  /**
   * SELECTION scope — the stateful per-step composite rank score for one candidate `(item, resource-state)`.
   * Sums the registered SELECTION constraints' signed contributions **in registration order, from 0** —
   * reproducing the inline `rank = (requiredDate − origin)/hr − bonus − expedite + notReady` bit-for-bit
   * (leading `0 +` is additive identity; the constraints are registered `[eddBase, changeover, expedite,
   * notReady]` so the fold matches the inline left-to-right order). Lower rank wins; the loop's argmin +
   * total-order tie-break stays inline (reproduced, not reordered).
   */
  selectionScore(model: ScheduleModel): number {
    let score = 0
    for (const c of this.selection) score += c.evaluate(model).contribution ?? 0
    return score
  }

  /**
   * PLACEMENT · CANDIDACY — is this op a placement candidate? Evaluates the registered CANDIDACY constraints
   * (readiness, eligibility); a violation (`degree > 0`) → not a candidate this iteration. No registered
   * constraint → a candidate (returns true). The candidacy decision is now entirely data-described (Commit 3).
   */
  candidacy(model?: () => ScheduleModel): boolean {
    const cs = this.placement.candidacy
    if (!cs || cs.length === 0) return true
    const m = model!()
    return cs.every((c) => c.evaluate(m).degree === 0)
  }

  /**
   * PLACEMENT · FLOOR — the resolved start floor. Composes the inline floor (the `Math.max` of prevFree /
   * origin / material / precedence / release) with any FLOOR constraints' contributions (the max). Commit 1:
   * none → returns `inlineFloorMs` unchanged. The arithmetic stays in the sequencer; only the *decision to
   * apply a floor* moves here (D-S1-5 — move the decision, reuse the arithmetic).
   */
  floor(inlineFloorMs: number, model?: () => ScheduleModel): number {
    const cs = this.placement.floor
    if (!cs || cs.length === 0) return inlineFloorMs
    const m = model!()
    let f = inlineFloorMs
    for (const c of cs) f = Math.max(f, c.evaluate(m).contribution ?? f)
    return f
  }

  /**
   * PLACEMENT · FLOOR (quantity) — the resolved run quantity. Composes the inline demand qty with any
   * quantity-FLOOR constraints' contributions (the max — e.g. the min-batch floor). Commit 1/empty: none →
   * returns `inlineQty` unchanged. The `max(demandQty, minBatch)` math stays the same; only the fold moved.
   */
  quantityFloor(inlineQty: number, model?: () => ScheduleModel): number {
    const cs = this.placement.quantityFloor
    if (!cs || cs.length === 0) return inlineQty
    const m = model!()
    let q = inlineQty
    for (const c of cs) q = Math.max(q, c.evaluate(m).contribution ?? q)
    return q
  }

  /**
   * PLACEMENT · CANDIDACY (resource-aware, pre-place veto — S1.2) — evaluated AFTER resource assignment, over
   * the resource-aware model (live `currentAttr`, `resourceFreeMs`). `true` = a registered constraint vetoed
   * this `(op, resource)` (`degree > 0`) → the reselect loop tries the next resource. **No registered
   * pre-place veto (S1.2) → returns false → never vetoes → the reselect branch is dead (byte-identical).**
   */
  preplaceVeto(model?: () => ScheduleModel): boolean {
    const cs = this.placement.preplaceVeto
    if (!cs || cs.length === 0) return false
    const m = model!()
    return cs.some((c) => c.evaluate(m).degree > 0)
  }

  /**
   * PLACEMENT · FEASIBILITY (post-place veto, reject form — S1.2) — evaluated after the degrade-form
   * {@link feasibility} over the placement outcome. `true` = a registered reject-form constraint rejects the
   * placement (`degree > 0`) → the reselect loop tries the next resource. This is DISTINCT from the degrade
   * form (which leaves the placement and lets the contiguous-fallback arithmetic handle it). **No registered
   * reject-form constraint (S1.2) → returns false → nothing is ever rejected (byte-identical).**
   */
  feasibilityRejects(model?: () => ScheduleModel): boolean {
    const cs = this.placement.feasibilityReject
    if (!cs || cs.length === 0) return false
    const m = model!()
    return cs.some((c) => c.evaluate(m).degree > 0)
  }

  /**
   * PLACEMENT · FEASIBILITY (degrade form) — the placement result after `placeJob`. Commit 1: no constraint
   * → returns `placed` unchanged. (The veto-and-reselect form is S1.2 — see {@link feasibilityRejects}.)
   */
  feasibility<T>(placed: T, model?: () => ScheduleModel): T {
    const cs = this.placement.feasibility
    if (!cs || cs.length === 0) return placed
    // Degrade form (Commit 5): evaluate the FEASIBILITY constraints over the placement outcome (recording
    // the verdict for S1.2's veto-and-reselect), but leave the placement unchanged — the sequencer's
    // contiguous-fallback arithmetic handles the null degrade. No reselect here.
    const m = model!()
    for (const c of cs) c.evaluate(m)
    return placed
  }
}

/** The default pipeline for a solve — Commit 1: empty (a pure pass-through). */
export const emptyPipeline = (): ConstraintPipeline => new ConstraintPipeline()
