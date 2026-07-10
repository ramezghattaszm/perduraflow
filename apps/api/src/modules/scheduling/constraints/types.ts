/**
 * Scheduling constraint framework (S1) — the universal declarative constraint abstraction.
 *
 * A constraint is a declarative object: a **predicate over a schedule-model** producing a **degree of
 * violation** (0 = satisfied, >0 = magnitude) and/or a **contribution** (a floor time, a rank delta) per its
 * **mechanism**, evaluated in one of two **scopes** (the S1.1 two-tier model):
 *  - `ORDERING` — evaluated ONCE, globally, before placement (the job order; EDD is the base here).
 *  - `PLACEMENT` — evaluated PER JOB during greedy placement, in the phase order
 *    `PRE_GATE → CANDIDACY → FLOOR → place → FEASIBILITY` (changeover is a PLACEMENT setup-cost lookup).
 *
 * The constraint knows nothing of *when* (loop vs objective) or *by which engine* (greedy vs CP-SAT, S4) it
 * is evaluated — adapters compile it. It is authored against the versioned {@link VOCABULARY_VERSION}
 * expression grammar (the internal representation S4 adapters + future customer-authoring expose), NOT ad-hoc
 * TypeScript predicates. Application mode (hard/soft/slack) is resolved config (S1.3) and lives outside this
 * shape. S1.1 Commit 1 defines the abstraction; no constraint is registered yet (the pipeline wraps the
 * existing inline logic pass-through) — mechanisms move in one at a time (Commits 2–5).
 */
import type { SequencerItem } from '../sequencer'

/**
 * Which scope evaluates the constraint (the proven two-scope model). `SELECTION` is the stateful per-step
 * scorer (the sole ordering mechanism); `PLACEMENT` is per-job post-selection. There is no `ORDERING` scope
 * — the DB input order is proven inert (the reverse-order diagnostic left the plan byte-identical).
 */
export type ConstraintScope = 'SELECTION' | 'PLACEMENT'

/**
 * How the framework applies a constraint's evaluation. `SELECTION` is the stateful per-step composite rank
 * scorer (the sole ordering mechanism); `PRE_GATE`/`CANDIDACY`/`FLOOR`/`FEASIBILITY` are `PLACEMENT`-scope
 * phases (per job).
 */
export type ConstraintMechanism = 'SELECTION' | 'PRE_GATE' | 'CANDIDACY' | 'FLOOR' | 'FEASIBILITY'

/**
 * The versioned internal expression representation constraints are authored against. Bumped on any grammar
 * change; S4 solver-adapters and eventual customer-authoring compile/expose THIS vocabulary rather than
 * re-implementing predicates. Extended (never rewritten) as mechanisms move (S1.1) + new types register (S2+).
 */
export const VOCABULARY_VERSION = '1.0.0'

/** The schedule-model fields the S1.1 grammar can read (the surface both tiers project onto). */
export type ScheduleModelField =
  | 'candidateStartMs'
  | 'requiredDateMs'
  | 'resourceFreeMs'
  | 'earliestStartMs'
  | 'predecessorEndMs'
  | 'releaseFloorMs'
  | 'originMs'

/**
 * The minimal S1.1 expression grammar — the internal representation. Deliberately small (the mechanisms
 * moving in Commits 2–5 need only floor arithmetic, rank deltas, and readiness/feasibility predicates); it
 * is EXTENDED, not rewritten, as richer constraint types (D28 matrices, D9 caps) register in S2+.
 */
export type Expr =
  | { readonly op: 'const'; readonly value: number }
  | { readonly op: 'field'; readonly field: ScheduleModelField }
  | { readonly op: 'max'; readonly args: readonly Expr[] }
  | { readonly op: 'sub'; readonly minuend: Expr; readonly subtrahend: Expr }
  | { readonly op: 'gt'; readonly left: Expr; readonly right: Expr }

/**
 * The schedule-model projection a constraint evaluates over. Both tiers build it; a constraint reads only
 * this (never the raw sequencer internals) — the seam that keeps constraints solver-neutral (S4).
 */
export interface ScheduleModel {
  readonly item: SequencerItem
  readonly resourceId: string
  /** The op's start floor at evaluation (epoch ms) — the FLOOR/FEASIBILITY reference. */
  readonly candidateStartMs: number
  readonly originMs: number
  readonly resourceFreeMs: number
  /** Set only for SELECTION evaluation: the assigned resource's **live** current changeover attribute (the
   *  last op placed on it, mutated after each placement) — the stateful input to the changeover rank-bonus. */
  readonly currentAttr?: string | null
  /** Set only for FEASIBILITY evaluation (post-`placeJob`): did the op fit a working segment? `false` = the
   *  placeJob → null degrade (op longer than any segment, no OT). Undefined at pre-placement evaluation. */
  readonly placedFeasible?: boolean
}

/**
 * One constraint's evaluation: a degree of violation (0 = satisfied) and/or a mechanism contribution — a
 * floor time (ms) for `FLOOR`, a rank delta for `RANK`; `CANDIDACY`/`FEASIBILITY` use `degree > 0` as veto.
 */
export interface ConstraintEvaluation {
  readonly degree: number
  readonly contribution?: number
}

/** The universal declarative constraint (both tiers, all five mechanisms). */
export interface Constraint {
  readonly id: string
  readonly scope: ConstraintScope
  readonly mechanism: ConstraintMechanism
  readonly vocabularyVersion: string
  evaluate(model: ScheduleModel): ConstraintEvaluation
}
