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
 * TEST-ONLY controllable in-use probe state for {@link TEST_REFSET}. The suppression spec toggles
 * `inUseKeys` to exercise BOTH gate branches (rejected vs allowed), and reads `calls` to assert the probe
 * is invoked ONLY on the suppress path. A real set (`asset_type`, 2b) implements a real probe over its
 * consumer's data instead. Entry format: `${tenantId}:${memberKey}`.
 */
export const __testInUseProbe = {
  inUseKeys: new Set<string>(),
  calls: [] as { tenantId: string; memberKey: string }[],
  reset(): void {
    this.inUseKeys.clear()
    this.calls.length = 0
  },
}

/**
 * TEST-ONLY reference set — a `replace`/list set exercising the substrate with NO domain consumer
 * (the `__` prefix marks it internal). Registers a controllable in-use probe ({@link __testInUseProbe})
 * so the suppression gate can be exercised. `asset_type` is NOT built here — it registers in Layer 2b with
 * its real probe. Defaults `[a, b, c]`, declared depth `{global, tenant}`.
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
  inUse: async (tenantId, memberKey) => {
    __testInUseProbe.calls.push({ tenantId, memberKey })
    return __testInUseProbe.inUseKeys.has(`${tenantId}:${memberKey}`)
  },
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
 * The reference-set registry. The two TEST-ONLY sets prove the mechanism (replace + merge); real sets
 * (`asset_type`, Layer 2b) are added at the composition root via {@link registerReferenceSet}, which
 * couples the descriptor to its in-use probe (the probe needs its owning domain module, wired through the
 * O7 binding — not available to this static module).
 */
export const REFERENCE_SETS: Record<string, ReferenceSetDescriptor> = {
  [TEST_REFSET.setKey]: TEST_REFSET,
  [TEST_MAP_REFSET.setKey]: TEST_MAP_REFSET,
}

/** Resolve a reference-set descriptor, or undefined for an unknown `set_key` (the caller 400s). */
export function getReferenceSetDescriptor(setKey: string): ReferenceSetDescriptor | undefined {
  return REFERENCE_SETS[setKey]
}

// --- real sets: descriptor + probe register together (D-L2-7) ----------------

/** An in-use probe — "does `memberKey` have any live referrer in this tenant?" (owning-module data). */
export type InUseProbe = (tenantId: string, memberKey: string) => Promise<boolean>

/** The `asset_type` set key — the taxonomy of tooling-asset kinds (tool / die / mold / fixture …). */
export const ASSET_TYPE_SET_KEY = 'asset_type'

/**
 * Build the `asset_type` reference-set descriptor (D-L2-7) — platform defaults `[tool, die, mold, fixture]`,
 * declared depth `{global, tenant}`, `replace` mode. The caller (composition root) MUST supply the in-use
 * probe (any active `tooling_asset` of the type), wired to Master Data through the O7 binding — so the
 * descriptor and its probe are inseparable ({@link registerReferenceSet} enforces it).
 */
export function buildAssetTypeReferenceSet(inUse: InUseProbe): ReferenceSetDescriptor {
  return {
    setKey: ASSET_TYPE_SET_KEY,
    platformDefaults: [
      { key: 'tool', metadata: { label: 'Tool' } },
      { key: 'die', metadata: { label: 'Die' } },
      { key: 'mold', metadata: { label: 'Mold' } },
      { key: 'fixture', metadata: { label: 'Fixture' } },
    ],
    declaredLevels: ['global', 'tenant'],
    resolutionMode: 'replace',
    inUse,
  }
}

/**
 * Register a real reference set into the substrate. The **safety invariant** (platform doc §3.6): a real
 * set registers its descriptor AND its in-use probe together — there is no descriptor-without-probe, so a
 * suppressable value can never be orphaned from its referential-safety gate. Idempotent per key (re-register
 * replaces). Called at the composition root, where the probe can be wired to its owning module (O7 binding).
 * @throws Error - the descriptor carries no in-use probe (the invariant is violated).
 */
export function registerReferenceSet(descriptor: ReferenceSetDescriptor): void {
  if (!descriptor.inUse) {
    throw new Error(`Reference set '${descriptor.setKey}' must register an in-use probe (safety invariant — no descriptor without a probe)`)
  }
  REFERENCE_SETS[descriptor.setKey] = descriptor
}
