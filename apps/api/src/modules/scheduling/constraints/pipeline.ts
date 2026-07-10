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
  feasibility?: Constraint[]
}

/**
 * The two-tier constraint pipeline (S1.1) — the registry the placement loop routes through.
 *
 * **ORDERING tier** ({@link order}) evaluates ONCE, globally, before placement — the job order (EDD's home,
 * Commit 4). **PLACEMENT tier** evaluates PER JOB in the declared phase order
 * `PRE_GATE → CANDIDACY → FLOOR → place → FEASIBILITY`. This ordered two-tier evaluation is part of the
 * determinism contract — extracting an ORDERING mechanism as a per-candidate PLACEMENT term (or a FLOOR
 * after CANDIDACY) would change *when* it evaluates and break byte-identicalness.
 *
 * **Commit 1 — WRAPPING, not moving:** no constraint is registered. Every method is a thin pass-through that
 * returns the inline-delegated value, so the loop routes THROUGH the pipeline yet computes byte-identically.
 * Mechanisms move in one at a time (Commits 2–5); when a phase gains constraints, its caller passes the
 * lazily-built {@link ScheduleModel} (never invoked while the phase is empty, so Commit 1 pays nothing).
 */
export class ConstraintPipeline {
  constructor(
    private readonly ordering: Constraint[] = [],
    private readonly placement: PlacementConstraints = {},
  ) {}

  /**
   * ORDERING tier — the global job order, evaluated ONCE before placement. Commit 1: no ORDERING constraint
   * → returns `items` unchanged (the seam EDD's global pre-sort fills in Commit 4). The greedy loop selects
   * order-invariantly (total-order tie-break), so a pass-through here cannot change the schedule.
   */
  order(items: SequencerItem[]): SequencerItem[] {
    if (this.ordering.length === 0) return items
    // (Commit 4: fold ORDERING constraints into a stable global sort key)
    return items
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
   * PLACEMENT · FEASIBILITY (degrade form) — the placement result after `placeJob`. Commit 1: no constraint
   * → returns `placed` unchanged. (The veto-and-reselect form is S1.2, not here.)
   */
  feasibility<T>(placed: T, _model?: () => ScheduleModel): T {
    const cs = this.placement.feasibility
    if (!cs || cs.length === 0) return placed
    // (S1.2: degrade-form feasibility constraints; veto-and-reselect is a later control-flow change)
    return placed
  }
}

/** The default pipeline for a solve — Commit 1: empty (a pure pass-through). */
export const emptyPipeline = (): ConstraintPipeline => new ConstraintPipeline()
