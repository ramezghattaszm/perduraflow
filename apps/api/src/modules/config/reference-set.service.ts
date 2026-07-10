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
  async resolveReferenceSet(setKey: string, tenantId: string, plantId?: string, lineId?: string): Promise<ResolvedReferenceSet> {
    const d = this.descriptorOrThrow(setKey)
    // S0b: `lineId` threads the line rung, but a set folds it only if `line` is in its declaredLevels
    // (none is in S0 — asset_type stays {global,tenant}). With no line depth declared, the walker never
    // reaches `line` → resolution is byte-identical to pre-S0b.
    const path = await walkScopePath<ReferenceSetOverride>(tenantId, plantId, d.declaredLevels, (level, scopeId) =>
      this.repo.findActive(tenantId, setKey, level, scopeId),
      lineId,
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
   * Either way the resolved membership is the UNION of member keys across the path. A level may also
   * **suppress** an inherited key via a tombstone (applied AFTER that level's contributions), removing it
   * from the resolved set — the membership analogue of config's reset-to-parent; a more-specific level
   * re-adding the key overrides the suppression (most-specific-wins). Returns members sorted by key.
   */
  private membershipFold(path: RefScopeRow[], d: ReferenceSetDescriptor): ReferenceSetMember[] {
    const merged = new Map<string, ReferenceMemberMetadata>()
    for (const m of d.platformDefaults) merged.set(m.key, { ...(m.metadata ?? {}) })

    for (const { row } of path) {
      const payload = row?.payload
      if (!payload) continue
      if (payload.members) {
        for (const [key, metadata] of Object.entries(payload.members)) {
          if (d.resolutionMode === 'merge') {
            merged.set(key, { ...(merged.get(key) ?? {}), ...metadata }) // shallow per-key merge up the path
          } else {
            merged.set(key, { ...metadata }) // replace: most-specific wins wholesale
          }
        }
      }
      // Suppression: a tombstone hides an inherited member (applied after this level's adds/overrides).
      if (payload.tombstones) {
        for (const key of payload.tombstones) merged.delete(key)
      }
    }

    return [...merged.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, metadata]) => ({ key, metadata }))
  }

  /**
   * Add or override a member's metadata at a level (a level's sparse contribution). It is an **`add`**
   * when the key does not yet resolve for this scope (a brand-new value) and an **`override`** when it
   * already resolves (inherited from a broader level, or previously set here) — the distinction is
   * recorded on the audit. Adding a key also lifts any tombstone for it at this level. Audited.
   * @throws AppException VALIDATION_ERROR - unknown set, or the member guard rejects the resulting set.
   */
  async setMember(
    setKey: string,
    level: 'tenant' | 'plant',
    scopeId: string,
    tenantId: string,
    memberKey: string,
    metadata: ReferenceMemberMetadata,
    userId: string | null,
  ): Promise<ResolvedReferenceSet> {
    const d = this.descriptorOrThrow(setKey)
    const plantId = level === 'plant' ? scopeId : undefined
    // Pre-state: does the key already resolve? → override (metadata change) vs add (new key).
    const before = await this.resolveReferenceSet(setKey, tenantId, plantId)
    const prior = before.members.find((m) => m.key === memberKey)
    const action = prior ? 'override' : 'add'

    const existing = await this.repo.findActive(tenantId, setKey, level, scopeId)
    const prev = existing?.payload ?? {}
    const members = { ...(prev.members ?? {}), [memberKey]: metadata }
    const tombstones = (prev.tombstones ?? []).filter((k) => k !== memberKey) // adding lifts a tombstone
    const payload = { members, ...(tombstones.length ? { tombstones } : {}) }

    // Optional member guard on the resulting resolved set (mirrors config's group guard).
    if (d.memberGuard) {
      const resulting = [...before.members.filter((m) => m.key !== memberKey), { key: memberKey, metadata }]
      const verdict = d.memberGuard(resulting)
      if (!verdict.ok) {
        throw new AppException(HttpStatus.BAD_REQUEST, verdict.warnings.join('; ') || 'Reference-set member guard rejected this change', ERROR_CODES.VALIDATION_ERROR)
      }
    }

    const revision = (existing?.revision ?? 0) + 1
    if (existing) await this.repo.update(existing.id, payload, revision, userId)
    else await this.repo.insert({ tenantId, setKey, level, scopeId, payload, revision })
    await this.repo.appendAudit([
      { tenantId, setKey, level, scopeId, memberKey, action, oldValue: prior?.metadata ?? null, newValue: metadata, revision, changedBy: userId },
    ])

    return this.resolveReferenceSet(setKey, tenantId, plantId)
  }

  /**
   * Suppress an inherited member at a level via a tombstone (the resolver then omits it). **Gated by the
   * in-use probe**: the descriptor MUST declare an `inUse` probe (no suppressable set without one — the
   * referential-safety invariant), and if the probe reports the value is still referenced the suppression
   * is rejected with `REFERENCE_VALUE_IN_USE`. `scopeId` is the tenantId (tenant level) or plantId (plant).
   * Audited.
   * @throws AppException VALIDATION_ERROR - unknown set, or the set declares no in-use probe (unsuppressable).
   * @throws AppException REFERENCE_VALUE_IN_USE - the member is still referenced (probe returned true).
   */
  async suppressMember(
    setKey: string,
    level: 'tenant' | 'plant',
    scopeId: string,
    tenantId: string,
    memberKey: string,
    userId: string | null,
  ): Promise<ResolvedReferenceSet> {
    const d = this.descriptorOrThrow(setKey)
    if (!d.inUse) {
      // Safety invariant (platform doc §3.6): a set with no in-use probe cannot be suppressed.
      throw new AppException(HttpStatus.BAD_REQUEST, `Reference set ${setKey} does not support suppression (no in-use probe)`, ERROR_CODES.VALIDATION_ERROR)
    }
    if (await d.inUse(tenantId, memberKey)) {
      throw new AppException(HttpStatus.CONFLICT, `Cannot suppress '${memberKey}' in ${setKey}: still in use`, ERROR_CODES.REFERENCE_VALUE_IN_USE)
    }

    const plantId = level === 'plant' ? scopeId : undefined
    const priorMeta = (await this.resolveReferenceSet(setKey, tenantId, plantId)).members.find((m) => m.key === memberKey)?.metadata ?? null

    const existing = await this.repo.findActive(tenantId, setKey, level, scopeId)
    const prev = existing?.payload ?? {}
    const tombstones = new Set(prev.tombstones ?? [])
    tombstones.add(memberKey)
    const members = { ...(prev.members ?? {}) }
    delete members[memberKey] // a level can't both add and suppress the same key
    const payload = { members, tombstones: [...tombstones] }
    const revision = (existing?.revision ?? 0) + 1
    if (existing) await this.repo.update(existing.id, payload, revision, userId)
    else await this.repo.insert({ tenantId, setKey, level, scopeId, payload, revision })
    await this.repo.appendAudit([
      { tenantId, setKey, level, scopeId, memberKey, action: 'suppress', oldValue: priorMeta, newValue: null, revision, changedBy: userId },
    ])

    return this.resolveReferenceSet(setKey, tenantId, plantId)
  }

  /**
   * Restore a suppressed member — remove its tombstone so it cascades from the parent again (the
   * membership analogue of reset-to-parent). Always safe → NO in-use probe. When the level's row is left
   * empty (no members, no tombstones) it is soft-deleted. Audited (only when a row actually changed).
   * @throws AppException VALIDATION_ERROR - unknown set.
   */
  async restoreMember(
    setKey: string,
    level: 'tenant' | 'plant',
    scopeId: string,
    tenantId: string,
    memberKey: string,
    userId: string | null,
  ): Promise<ResolvedReferenceSet> {
    this.descriptorOrThrow(setKey)
    const existing = await this.repo.findActive(tenantId, setKey, level, scopeId)
    if (existing && (existing.payload?.tombstones ?? []).includes(memberKey)) {
      const prev = existing.payload ?? {}
      const tombstones = (prev.tombstones ?? []).filter((k) => k !== memberKey)
      const members = prev.members ?? {}
      const revision = existing.revision + 1
      if (Object.keys(members).length === 0 && tombstones.length === 0) {
        await this.repo.deactivate(existing.id, userId)
      } else {
        await this.repo.update(existing.id, { members, tombstones }, revision, userId)
      }
      await this.repo.appendAudit([
        { tenantId, setKey, level, scopeId, memberKey, action: 'restore', oldValue: null, newValue: null, revision, changedBy: userId },
      ])
    }
    return this.resolveReferenceSet(setKey, tenantId, level === 'plant' ? scopeId : undefined)
  }
}
