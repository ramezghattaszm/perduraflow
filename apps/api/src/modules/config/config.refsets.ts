import type { ConfigLevel } from '@perduraflow/contracts'
import type { ReferenceMemberMetadata } from './schema'

/** One member of a reference set — a key plus optional per-value metadata (label / i18n key / flags). */
export interface ReferenceSetMember {
  key: string
  metadata?: ReferenceMemberMetadata
}

/** How a member key resolved at multiple levels folds: `replace` = most-specific wins wholesale; `merge` = shallow per-key metadata merge. */
export type ReferenceResolutionMode = 'replace' | 'merge'

/**
 * A reference set's plug-in descriptor — the reference-set analogue of a config group descriptor
 * (CONFIG-REFERENCE-SET-SCOPE §5, D-CFG-4). Registered into config by the owning domain module. Carries
 * its `set_key`, platform-default members (the `global` floor), the levels it resolves at (declared
 * depth — a set pays only for the rungs it opts into), its resolution mode, an optional member guard, and
 * an **`inUse` probe hook** the owning module implements so suppression can be safely gated (Commit 3).
 * The probe is INTERFACE-ONLY here — no set registers one in Commit 2.
 */
export interface ReferenceSetDescriptor {
  setKey: string
  /** The shipped platform-default members (the `global` floor — never stored). */
  platformDefaults: ReferenceSetMember[]
  /** The ladder rungs this set resolves at (e.g. `['global','tenant']`) — the walker stops at the deepest declared. */
  declaredLevels: ConfigLevel[]
  resolutionMode: ReferenceResolutionMode
  /** Optional guard run on the fully-resolved member set before a write is accepted (Commit 4). */
  memberGuard?: (members: ReferenceSetMember[]) => { ok: boolean; warnings: string[] }
  /**
   * In-use probe — "does a `memberKey` have any live referrer in this tenant?" Owned/implemented by the
   * consuming domain module (for `asset_type`: any `tooling_asset` of this type). Commit 3 gates
   * suppression on it (reject with `REFERENCE_VALUE_IN_USE` when true). No set registers one in Commit 2.
   */
  inUse?: (tenantId: string, memberKey: string) => Promise<boolean>
}

/**
 * TEST-ONLY reference set — a `replace`/list set exercising the substrate with NO domain consumer
 * (the `__` prefix marks it internal). `asset_type` is NOT built here — it registers in Layer 2b with
 * its in-use probe. Defaults `[a, b, c]`, declared depth `{global, tenant}`.
 */
const TEST_REFSET: ReferenceSetDescriptor = {
  setKey: '__test_refset',
  platformDefaults: [
    { key: 'a', metadata: { label: 'Alpha' } },
    { key: 'b', metadata: { label: 'Bravo' } },
    { key: 'c', metadata: { label: 'Charlie' } },
  ],
  declaredLevels: ['global', 'tenant'],
  resolutionMode: 'replace',
}

/**
 * TEST-ONLY reference set — a `merge`/map-like set: a member key contributed at multiple levels has its
 * metadata SHALLOW key-merged up the path (the N-level generalization of Layer-1's `shared_attributes`
 * two-level merge; nested-deep deferred). Exercises `merge` mode with no domain consumer.
 */
const TEST_MAP_REFSET: ReferenceSetDescriptor = {
  setKey: '__test_map',
  platformDefaults: [
    { key: 'x', metadata: { color: 'red', size: 'L' } },
    { key: 'y', metadata: { color: 'green', size: 'M' } },
  ],
  declaredLevels: ['global', 'tenant'],
  resolutionMode: 'merge',
}

/**
 * The reference-set registry. Commit 2: two TEST-ONLY sets prove the mechanism (replace + merge). Real
 * sets (`asset_type`, Layer 2b) register their descriptor **and** in-use probe together.
 */
export const REFERENCE_SETS: Record<string, ReferenceSetDescriptor> = {
  [TEST_REFSET.setKey]: TEST_REFSET,
  [TEST_MAP_REFSET.setKey]: TEST_MAP_REFSET,
}

/** Resolve a reference-set descriptor, or undefined for an unknown `set_key` (the caller 400s). */
export function getReferenceSetDescriptor(setKey: string): ReferenceSetDescriptor | undefined {
  return REFERENCE_SETS[setKey]
}
