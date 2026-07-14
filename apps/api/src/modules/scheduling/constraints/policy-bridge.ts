import { createHash } from 'node:crypto'
import { CONSTRAINT_POLICIES, type ConstraintMode, type RationaleFactor, type ResolvedConstraintPolicy } from '@perduraflow/contracts'
import type { Constraint, ScheduleModel } from './types'
import { VOCABULARY_VERSION } from './types'

/**
 * The sentinel line key for the PLANT-level (no-line) resolution when serializing (S1.4). `byLine` is keyed
 * by `string | null`; JSON has no null key, so the null (plant) scope is emitted under this fixed sentinel.
 * `_` is outside the ULID alphabet (Crockford base32, uppercase), so it can never collide with a real
 * `lineId`; the serializer sorts the keys as strings for a deterministic, stable digest.
 */
export const PLANT_SCOPE_KEY = '__plant__'

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

  /**
   * S1.4 — canonical serialization of THIS instance's resolved policies per scope (the D6 snapshot's policy
   * half). A **method on the class** so the snapshot serializes the SAME object the bridge evaluates against
   * (`byLine`) — never a parallel re-derivation from config, which is exactly the drift D-S1.3-7 prevents.
   * Serializes the REAL content ALWAYS (no `isEmpty` short-circuit — that is a registry check, not a check on
   * this instance): the constant empty digest today is EMERGENT because `byLine` is empty, not special-cased.
   * The null (plant) line key is emitted under {@link PLANT_SCOPE_KEY}; lines + modes are sorted for a stable
   * digest. `resourceLine` (resource→line topology) is master-data, reconstructable at replay from the
   * version's resources — it is NOT policy, so it is not part of the resolved SET.
   */
  serialize(): { policies: { line: string; modes: { id: string; mode: ConstraintMode; threshold: number | null }[] }[] } {
    const policies = [...this.byLine.entries()]
      .map(([line, policy]) => ({
        line: line ?? PLANT_SCOPE_KEY,
        modes: Object.keys(policy.modes)
          .sort()
          .map((id) => ({ id, mode: policy.modes[id]!.mode, threshold: policy.modes[id]!.threshold })),
      }))
      .sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0))
    return { policies }
  }
}

/**
 * The D6 resolved-constraint-set snapshot (S1.4) — content-addressed onto every committed `schedule_version`.
 * Two halves, both needed to REPLAY: the **resolved policies per scope** (`resolution.serialize()`) AND the
 * **registry identity** — which constraints existed + their `vocabularyVersion` (from
 * {@link MODE_GOVERNED_CONSTRAINTS}, the predicates the bridge actually uses) + the framework
 * {@link VOCABULARY_VERSION}. A set that records modes but not which constraints existed cannot be replayed.
 * **Empty/constant while inert** (both registries empty) — emergent, not special-cased.
 */
export interface ConstraintSetSnapshot {
  vocabularyVersion: string
  constraints: { id: string; vocabularyVersion: string }[]
  policies: { line: string; modes: { id: string; mode: ConstraintMode; threshold: number | null }[] }[]
}

/** Build the full D6 snapshot for a resolved set — the policies (from the class serializer) + the registry
 *  identity. This is what gets content-addressed onto the version; empty/constant while inert. */
export function buildConstraintSet(resolution: ConstraintPolicyResolution): ConstraintSetSnapshot {
  return {
    vocabularyVersion: VOCABULARY_VERSION,
    constraints: MODE_GOVERNED_CONSTRAINTS.map((g) => ({ id: g.constraintId, vocabularyVersion: g.constraint.vocabularyVersion })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    policies: resolution.serialize().policies,
  }
}

/** Recursively key-sorted JSON so the content digest is field-order-independent (matches the harnesses). */
const canonicalize = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]))
    : Array.isArray(v)
      ? v.map(canonicalize)
      : v

/** The EXACT canonical JSON that is digested — stored as `constraint_set.content` so the persisted blob is
 *  byte-faithful to what the digest addresses (replay reads back precisely what was recorded). */
export function canonicalConstraintSetJson(set: ConstraintSetSnapshot): string {
  return JSON.stringify(canonicalize(set))
}

/** The content address (SHA-256) of a snapshot — the `constraint_set.id` / `schedule_version.constraint_set_ref`. */
export function digestConstraintSet(set: ConstraintSetSnapshot): string {
  return createHash('sha256').update(canonicalConstraintSetJson(set)).digest('hex')
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
 * THE production seam — the exact constraint application the solve uses: pre-resolve the per-line policy ONCE,
 * derive the S1.2 veto from the {@link MODE_GOVERNED_CONSTRAINTS} registry, and hand back **both** the derived
 * `veto` (threaded into `sequence()`) AND the `resolution` (the SAME object the veto evaluates against — S1.4
 * snapshots it via {@link buildConstraintSet}, never a parallel re-derivation). `scheduling.service` calls
 * ONLY this (no ad-hoc veto array, no second config resolution), so a test can call the SAME function and
 * assert what production actually threads is empty. **Empty while inert** (empty registry).
 */
export async function buildSolveVetoConstraints(
  read: { resolveConstraintPolicy(tenantId: string, plantId?: string, lineId?: string): Promise<ResolvedConstraintPolicy> },
  tenantId: string,
  plantId: string,
  resources: readonly { id: string; lineId: string | null }[],
): Promise<{ resolution: ConstraintPolicyResolution; veto: { preplaceVeto: Constraint[]; feasibilityReject: Constraint[] } }> {
  const resolution = await resolveConstraintPolicies(read, tenantId, plantId, resources)
  const veto = deriveVetoConstraints(MODE_GOVERNED_CONSTRAINTS, resolution)
  return { resolution, veto }
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
