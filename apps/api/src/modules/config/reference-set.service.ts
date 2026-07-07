import { HttpStatus, Injectable } from '@nestjs/common'
import { ERROR_CODES } from '@perduraflow/contracts'
import { AppException } from '../../common/exceptions/app.exception'
import {
  getReferenceSetDescriptor,
  type ReferenceSetDescriptor,
  type ReferenceSetMember,
} from './config.refsets'
import { ReferenceSetRepository } from './reference-set.repository'
import { type ScopeLevelRow, walkScopePath } from './scope-path'
import type { ReferenceMemberMetadata, ReferenceSetOverride } from './schema'

/** A reference-set scope-path rung: the level + its stored reference-set-override row. */
type RefScopeRow = ScopeLevelRow<ReferenceSetOverride>

/** A resolved reference set — its members after the membership fold (suppression applied in Commit 3). */
export interface ResolvedReferenceSet {
  setKey: string
  members: ReferenceSetMember[]
}

/**
 * Reference-set framework service (CONFIG-REFERENCE-SET-SCOPE §5) — the SECOND content kind on config's
 * scope substrate, alongside the scalar config groups. It rides the SAME {@link walkScopePath} walker as
 * config's scalar `resolve()`; only the FOLD differs (membership vs scalar). Commit 2 builds the descriptor
 * registry, storage, and the membership fold (add/override + union, `replace`/`merge`); tombstone
 * suppression + the in-use gate are Commit 3; the `reference.read` contract + admin CRUD + audit are Commit 4.
 */
@Injectable()
export class ReferenceSetService {
  constructor(private readonly repo: ReferenceSetRepository) {}

  private descriptorOrThrow(setKey: string): ReferenceSetDescriptor {
    const d = getReferenceSetDescriptor(setKey)
    if (!d) {
      throw new AppException(HttpStatus.BAD_REQUEST, `Unknown or unregistered reference set: ${setKey}`, ERROR_CODES.VALIDATION_ERROR)
    }
    return d
  }

  /**
   * Resolve a reference set's effective members for a tenant (+ optional plant): platform defaults, then
   * each declared level up the scope path folded in. Cascade honors the descriptor's declared depth (the
   * walker skips undeclared rungs). Suppression (tombstones) is applied in Commit 3.
   * @throws AppException VALIDATION_ERROR - the set is not registered.
   */
  async resolveReferenceSet(setKey: string, tenantId: string, plantId?: string): Promise<ResolvedReferenceSet> {
    const d = this.descriptorOrThrow(setKey)
    const path = await walkScopePath<ReferenceSetOverride>(tenantId, plantId, d.declaredLevels, (level, scopeId) =>
      this.repo.findActive(tenantId, setKey, level, scopeId),
    )
    return { setKey, members: this.membershipFold(path, d) }
  }

  /**
   * The membership fold — the reference-set analogue of config's `scalarFold`. Start from the platform
   * defaults (the `global` floor), then apply each stored level up the path (broadest → narrowest):
   * - **replace** (list/scalar sets): a level's member REPLACES the inherited member of the same key
   *   wholesale (most-specific-wins).
   * - **merge** (map-like sets): a level's member metadata is SHALLOW key-merged onto the inherited
   *   metadata (per-key; the N-level generalization of Layer-1's two-level `shared_attributes` merge).
   *
   * Either way the resolved membership is the UNION of member keys across the path. Returns members sorted
   * by key (deterministic). **Tombstone suppression is Commit 3** (this fold does not yet omit any key).
   */
  private membershipFold(path: RefScopeRow[], d: ReferenceSetDescriptor): ReferenceSetMember[] {
    const merged = new Map<string, ReferenceMemberMetadata>()
    for (const m of d.platformDefaults) merged.set(m.key, { ...(m.metadata ?? {}) })

    for (const { row } of path) {
      const members = row?.payload?.members
      if (!members) continue
      for (const [key, metadata] of Object.entries(members)) {
        if (d.resolutionMode === 'merge') {
          merged.set(key, { ...(merged.get(key) ?? {}), ...metadata }) // shallow per-key merge up the path
        } else {
          merged.set(key, { ...metadata }) // replace: most-specific wins wholesale
        }
      }
    }

    return [...merged.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, metadata]) => ({ key, metadata }))
  }
}
