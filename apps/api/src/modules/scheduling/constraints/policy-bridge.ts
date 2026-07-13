import { CONSTRAINT_POLICIES, type ConstraintMode, type RationaleFactor, type ResolvedConstraintPolicy } from '@perduraflow/contracts'
import type { Constraint, ScheduleModel } from './types'

/**
 * S1.3 — the mode → behavior bridge. Turns a per-constraint APPLICATION MODE (resolved from config,
 * `hard | soft | hard-with-slack`) into engine behavior:
 *   - **hard** → an S1.2 veto (enforced, not just reported) — routed to `preplaceVeto` / `feasibilityReject`.
 *   - **hard-with-slack** → a veto only past the resolved threshold.
 *   - **soft** → an objective factor (via the Option-B keyed registry) + an honest `ConstraintBinding`.
 *
 * **Inert in S1.3.** No constraint carries a mode: {@link CONSTRAINT_POLICIES} is empty AND
 * {@link MODE_GOVERNED_CONSTRAINTS} is empty (D28/D9/JIS are S2/S3). So every derivation below returns an
 * EMPTY set — no veto is registered, no factor is added, the honest binding stays `false` — and the plan +
 * objective + comparative surfaces are byte-identical. The synthetic-mode test exercises the live paths OFF
 * the demo, exactly as S1.2's synthetic-veto test does.
 */

/**
 * The per-line application policy **pre-resolved once per solve** (D-S1.3-7) — NOT resolved per-op inside the
 * placement loop (async I/O there would break the sequencer's purity/determinism). Holds the `lineId → policy`
 * map + the `resourceId → lineId` lookup so a derived veto can read a mode by the PLACED resource's line at
 * evaluation. This is the first-class resolved set S1.4's D6 audit snapshot will capture (it is part of the
 * determinism key). Empty while inert.
 */
export class ConstraintPolicyResolution {
  constructor(
    private readonly byLine: Map<string | null, ResolvedConstraintPolicy>,
    private readonly resourceLine: Map<string, string | null>,
  ) {}

  /** No registered policy → the bridge applies nothing (the inertness fast-path). */
  get isEmpty(): boolean {
    return CONSTRAINT_POLICIES.length === 0
  }

  /** The resolved mode (+ slack threshold) for `constraintId` on the line that owns `resourceId`; null when
   *  ungoverned / no policy resolves (then the constraint is not applied). */
  modeFor(resourceId: string, constraintId: string): { mode: ConstraintMode; threshold: number | null } | null {
    const line = this.resourceLine.get(resourceId) ?? null
    return this.byLine.get(line)?.modes[constraintId] ?? null
  }
}

/** A constraint whose APPLICATION is config-governed — its predicate paired with the id its mode resolves by. */
export interface PolicyGovernedConstraint {
  constraintId: string
  /** The predicate (`degree > 0` = violated); the resolved mode decides HOW the violation is applied. */
  constraint: Constraint
}

/**
 * The registry of mode-governed constraints — **EMPTY in S1.3**. D28 (forbidden-transition / max-consecutive),
 * D9 (single-location / tool-life), and JIS (S2/S3) append here, each paired with its config `constraintId`.
 * An empty registry means every derivation returns an empty set → the bridge is inert.
 */
export const MODE_GOVERNED_CONSTRAINTS: PolicyGovernedConstraint[] = []

/**
 * Pre-resolve the application policy for every line present in the plant (D-S1.3-7). Inert fast-path: with no
 * registered policy the resolution is empty and NO config read is issued. `read` is the `config.read` surface.
 */
export async function resolveConstraintPolicies(
  read: { resolveConstraintPolicy(tenantId: string, plantId?: string, lineId?: string): Promise<ResolvedConstraintPolicy> },
  tenantId: string,
  plantId: string,
  resources: readonly { id: string; lineId: string | null }[],
): Promise<ConstraintPolicyResolution> {
  const resourceLine = new Map(resources.map((r) => [r.id, r.lineId] as const))
  const byLine = new Map<string | null, ResolvedConstraintPolicy>()
  if (CONSTRAINT_POLICIES.length === 0) return new ConstraintPolicyResolution(byLine, resourceLine)
  for (const line of new Set(resources.map((r) => r.lineId))) {
    byLine.set(line, await read.resolveConstraintPolicy(tenantId, plantId, line ?? undefined))
  }
  return new ConstraintPolicyResolution(byLine, resourceLine)
}

/**
 * Wrap a governed constraint as a veto that fires ONLY where its resolved mode is `hard` / `hard-with-slack`
 * (past the threshold), reading the mode by the placed resource's line (D-S1.3-7). `soft`/ungoverned → the
 * veto is inert (degree 0) — a soft violation is a factor, not a veto.
 */
export const asVeto = (g: PolicyGovernedConstraint, resolution: ConstraintPolicyResolution): Constraint => ({
  id: `policy.veto.${g.constraintId}`,
  scope: g.constraint.scope,
  mechanism: g.constraint.mechanism,
  vocabularyVersion: g.constraint.vocabularyVersion,
  evaluate: (m: ScheduleModel) => {
    const resolved = resolution.modeFor(m.resourceId, g.constraintId)
    if (!resolved || resolved.mode === 'soft') return { degree: 0 } // soft/ungoverned → not a veto
    const { degree } = g.constraint.evaluate(m)
    const trip = resolved.mode === 'hard-with-slack' ? degree > (resolved.threshold ?? 0) : degree > 0
    return { degree: trip ? 1 : 0 }
  },
})

/**
 * Derive the S1.2 veto seam (`preplaceVeto` / `feasibilityReject`) from the resolved HARD modes. Routing
 * follows the governed constraint's mechanism: `FEASIBILITY` → post-place reject; else → pre-place CANDIDACY.
 * **EMPTY while `governed` is empty (S1.3)** → the reselect branch stays dead → byte-identical.
 */
export function deriveVetoConstraints(
  governed: readonly PolicyGovernedConstraint[],
  resolution: ConstraintPolicyResolution,
): { preplaceVeto: Constraint[]; feasibilityReject: Constraint[] } {
  const preplaceVeto: Constraint[] = []
  const feasibilityReject: Constraint[] = []
  for (const g of governed) {
    const veto = asVeto(g, resolution)
    if (g.constraint.mechanism === 'FEASIBILITY') feasibilityReject.push(veto)
    else preplaceVeto.push(veto)
  }
  return { preplaceVeto, feasibilityReject }
}

/**
 * The constraint ids that are HARD-enforced anywhere in the resolution — the input to the HONEST
 * `ConstraintBinding` (a hard constraint's `binding` is finally derived, not hardcoded `false`). **Empty while
 * inert** → every hard binding stays `false`, byte-identical.
 */
export function deriveEnforcedHardKeys(
  governed: readonly PolicyGovernedConstraint[],
  resolution: ConstraintPolicyResolution,
): ReadonlySet<string> {
  const keys = new Set<string>()
  if (resolution.isEmpty) return keys
  for (const g of governed) {
    for (const c of CONSTRAINT_POLICIES) {
      if (c.constraintId === g.constraintId && c.defaultMode !== 'soft') keys.add(g.constraintId)
    }
  }
  return keys
}

/**
 * Build a SOFT constraint's objective factor from its violation `degree` (via the Option-B keyed registry).
 * The what-if scorer appends these to its factor list; the bridge produces them from `soft`-mode governed
 * constraints. **None are produced in S1.3** (no governed soft constraint) — this is the seam S2 fills.
 */
export const softFactor = (
  key: string,
  unit: string,
  rawValue: number,
  weight: number,
  detailKey: string,
  detailParams: Record<string, string | number>,
): RationaleFactor => {
  const contribution = Number((rawValue * weight).toFixed(4))
  return {
    key,
    labelKey: `whatif.factorLabel.${key}`,
    rawValue,
    unit,
    weight,
    contribution,
    direction: contribution > 0 ? 'worsens' : contribution < 0 ? 'improves' : 'neutral',
    detailKey,
    detailParams,
  }
}
