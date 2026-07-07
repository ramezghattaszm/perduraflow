import { z } from 'zod'

/**
 * Configurable reference-set read contract (`reference.read`) — the resolved, suppression-applied member
 * sets consumers (and admin typeahead/pickers) read for their scope (PLATFORM-CONFIGURABLE-REFERENCE-SETS).
 * The SECOND content kind on the config scope substrate, alongside the scalar `config.read` groups: config
 * resolves a *scalar field within a group*; this resolves a *keyed collection a tenant extends/suppresses*.
 * Resolution is `platform → tenant → plant` (declared depth per set); consumers must-ignore members they
 * don't recognize (A12 open-enum discipline — safe because reference sets are taxonomic, no code branch).
 *
 * Stage: the substrate + two test-only sets. `asset_type` (the first real set) registers in Layer 2b with
 * its in-use probe. No transport in the interface (O6); tenant/plant scoped by the caller.
 */
export const REFERENCE_READ_CONTRACT = { id: 'reference.read', version: '1.0' } as const

/** A reference-set member's per-value metadata (label / i18n key / behavior flags) — a flat scalar map. */
export type ReferenceMemberValue = number | string | boolean

/** A resolved reference-set member — its key + folded metadata (suppression already applied). */
export interface ReferenceSetMemberDto {
  key: string
  metadata: Record<string, ReferenceMemberValue>
}

/** A resolved reference set for a scope — the member list after the membership fold + suppression. */
export interface ResolvedReferenceSetDto {
  setKey: string
  members: ReferenceSetMemberDto[]
}

/** How a reference set folds across the scope path: `replace` (most-specific-wins) or `merge` (per-key metadata merge). */
export type ReferenceResolutionMode = 'replace' | 'merge'

/** A registered reference set's summary (for admin listings / pickers) — its key, declared depth, and mode. */
export interface ReferenceSetSummaryDto {
  setKey: string
  /** The scope levels this set resolves at (declared depth), e.g. `['global','tenant']`. */
  declaredLevels: string[]
  resolutionMode: ReferenceResolutionMode
}

/**
 * Published `reference.read 1.0` — in-process resolution of a reference set's effective members for a
 * scope. Registered as a binding counterpart at the composition root (O7), resolved like `masterdata.read`.
 */
export interface ReferenceReadContract {
  readonly contract: typeof REFERENCE_READ_CONTRACT
  /** The resolved members for a set + scope (`platform → tenant → plant`, suppression applied). */
  resolveReferenceSet(tenantId: string, setKey: string, opts?: { plantId?: string }): Promise<ResolvedReferenceSetDto>
  /** The registered reference sets (summaries) — tenant-agnostic (the registry is platform-global). */
  listReferenceSets(): Promise<ReferenceSetSummaryDto[]>
}

// --- admin CRUD request schemas (reference-set admin screens) ----------------

/** A member's metadata map (add/override body) — flat scalar values. */
export const referenceMemberMetadataSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]))

/**
 * PUT body — add or override a member's metadata at a level. Adding a key not yet in the resolved set is
 * an `add`; setting a key that already resolves (inherited/at this level) is an `override`. Validated
 * server-side against the set descriptor (+ any member guard).
 */
export const setReferenceMemberSchema = z
  .object({ metadata: referenceMemberMetadataSchema.default({}) })
  .strict()
export type SetReferenceMemberRequest = z.infer<typeof setReferenceMemberSchema>
