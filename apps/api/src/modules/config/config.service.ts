import { HttpStatus, Injectable } from '@nestjs/common'
import {
  type ConfigFieldView,
  type ConfigGroupKey,
  type ConfigGroupView,
  type ConfigLevel,
  type ConfigValue,
  ERROR_CODES,
} from '@perduraflow/contracts'
import { AppException } from '../../common/exceptions/app.exception'
import { getGroupDescriptor } from './config.groups'
import { ConfigRepository } from './config.repository'
import { SCOPE_LADDER, type ScopeLevelRow, walkScopePath } from './scope-path'
import type { ConfigOverride } from './schema'

/** A resolved group: the effective values + the level each field resolved from. */
export interface ResolvedConfig<T extends Record<string, ConfigValue> = Record<string, ConfigValue>> {
  values: T
  provenance: Record<string, ConfigLevel>
  /** The winning override's revision per level (for the version token / audit display). `line` is the S0b
   *  rung — always null until a group declares `line` depth (S1); the determinism token reads only
   *  tenant/plant, so this additive key never shifts it. */
  revisions: { tenant: number | null; plant: number | null; line: number | null }
}

/** A config scope-path rung: the level + its stored config-override row (specialization of the shared {@link ScopeLevelRow}). */
type ConfigScopeRow = ScopeLevelRow<ConfigOverride>

/**
 * Config framework service (CONFIG-FRAMEWORK-DESIGN). The generic resolve → cascade → reset →
 * audit mechanism every setting group plugs into. Resolution is **plant → tenant → global** per
 * field (most specific wins; `global` is the in-code descriptor default). Overrides are stored
 * **sparse** so each field's provenance is exact. Tenant/plant writes are audited (who/when/
 * group/field/old→new) and bump a revision (versioning). No group-specific code lives here —
 * groups contribute a {@link ConfigGroupDescriptor} (defaults + fields + optional guard).
 */
@Injectable()
export class ConfigService {
  constructor(private readonly repo: ConfigRepository) {}

  private descriptorOrThrow(group: ConfigGroupKey) {
    const d = getGroupDescriptor(group)
    if (!d) {
      throw new AppException(HttpStatus.BAD_REQUEST, `Unknown or unregistered config group: ${group}`, ERROR_CODES.VALIDATION_ERROR)
    }
    return d
  }

  /**
   * The ordered scope path for a context — the stored override row at each realized ladder rung
   * (broadest → narrowest), driven by {@link SCOPE_LADDER}. `global` carries no stored row (the
   * descriptor default is the floor); `plant` is only walked when a `plantId` is in context. This is
   * the ONE place the ladder is walked — a fold (scalar or, later, membership) plugs on top of it.
   */
  private scopePath(group: ConfigGroupKey, tenantId: string, plantId?: string, lineId?: string): Promise<ConfigScopeRow[]> {
    // Config groups walk the full ladder; `plant`/`line` are skipped when no plantId/lineId is in context.
    // No config caller threads a `lineId` in S0 (line depth is S1) → the line rung is inert (byte-identical).
    return walkScopePath<ConfigOverride>(tenantId, plantId, SCOPE_LADDER, (level, scopeId) =>
      this.repo.findActive(tenantId, group, level, scopeId),
      lineId,
    )
  }

  /**
   * The scalar-field fold — the EXISTING config resolution, pure-extracted: per field, the most-specific
   * level that supplies a value wins (walking broadest → narrowest, a defined value at a deeper rung
   * overrides), else the descriptor default (`global`). Records per-field provenance and the per-level
   * override revisions. Behavior is byte-identical to the prior two-fetch `resolve()`.
   */
  private scalarFold<T extends Record<string, ConfigValue> = Record<string, ConfigValue>>(
    path: ConfigScopeRow[],
    d: ReturnType<ConfigService['descriptorOrThrow']>,
  ): ResolvedConfig<T> {
    const values: Record<string, ConfigValue> = {}
    const provenance: Record<string, ConfigLevel> = {}
    for (const f of d.fields) {
      let value: ConfigValue = d.defaults[f.key]!
      let from: ConfigLevel = 'global'
      for (const { level, row } of path) {
        const v = row?.payload?.[f.key]
        if (v !== undefined) {
          value = v
          from = level
        }
      }
      values[f.key] = value
      provenance[f.key] = from
    }
    const byLevel = new Map(path.map((p) => [p.level, p.row]))
    return {
      values: values as T,
      provenance,
      // `line` is additive (S0b) — null with no line rung in the path, so an existing group's revisions
      // object is byte-unchanged for the token (which reads tenant/plant), only gaining a null `line`.
      revisions: {
        tenant: byLevel.get('tenant')?.revision ?? null,
        plant: byLevel.get('plant')?.revision ?? null,
        line: byLevel.get('line')?.revision ?? null,
      },
    }
  }

  /**
   * Resolve a group's effective settings for a tenant (+ optional plant), with per-field
   * provenance. Cascade: plant override → tenant override → global default. Now a {@link scalarFold}
   * over the shared {@link scopePath} — behavior unchanged from the prior hardcoded two-fetch resolve.
   * @throws AppException VALIDATION_ERROR - the group is not registered.
   */
  async resolve<T extends Record<string, ConfigValue> = Record<string, ConfigValue>>(
    group: ConfigGroupKey,
    tenantId: string,
    plantId?: string,
    lineId?: string,
  ): Promise<ResolvedConfig<T>> {
    const d = this.descriptorOrThrow(group)
    // `lineId` is the S0b rung — threaded through the walker but inert until a consumer resolves at line
    // depth (S1); with none in context the path is the exact pre-S0b global→tenant→plant sequence.
    const path = await this.scopePath(group, tenantId, plantId, lineId)
    return this.scalarFold<T>(path, d)
  }

  /** The config UI view of a group — per-field cascade columns (global/tenant/plant) + provenance. */
  async getGroupView(group: ConfigGroupKey, tenantId: string, plantId?: string): Promise<ConfigGroupView> {
    const d = this.descriptorOrThrow(group)
    const tenantRow = await this.repo.findActive(tenantId, group, 'tenant', tenantId)
    const plantRow = plantId ? await this.repo.findActive(tenantId, group, 'plant', plantId) : undefined
    const resolved = await this.resolve(group, tenantId, plantId)

    const fields: ConfigFieldView[] = d.fields.map((f) => ({
      key: f.key,
      value: resolved.values[f.key]!,
      provenance: resolved.provenance[f.key]!,
      global: d.defaults[f.key]!,
      tenant: tenantRow?.payload?.[f.key] ?? null,
      plant: plantRow?.payload?.[f.key] ?? null,
      // S0b rung — no line scope in the config view (line depth is S1); always null here.
      line: null,
      kind: f.kind,
      display: f.display ?? 'raw',
      control: f.control ?? (f.kind === 'boolean' ? 'toggle' : 'number'),
      ...(f.min !== undefined ? { min: f.min } : {}),
      ...(f.max !== undefined ? { max: f.max } : {}),
      ...(f.sliderMax !== undefined ? { sliderMax: f.sliderMax } : {}),
      ...(f.sliderStep !== undefined ? { sliderStep: f.sliderStep } : {}),
    }))
    return {
      group,
      scopePlantId: plantId ?? null,
      fields,
      revisions: { tenant: tenantRow?.revision ?? null, plant: plantRow?.revision ?? null },
    }
  }

  /**
   * Set a sparse override at a level (the rest cascade from the parent). Validates the resulting
   * resolved set against the group guard, persists the merged payload (bumping the revision), and
   * audits each changed field. `scopeId` is the tenantId (tenant level) or plantId (plant level).
   * @throws AppException VALIDATION_ERROR - unknown group / field, or the group guard rejects the set.
   */
  async setOverride(
    group: ConfigGroupKey,
    level: 'tenant' | 'plant',
    scopeId: string,
    tenantId: string,
    fields: Record<string, ConfigValue>,
    userId: string | null,
  ): Promise<ConfigGroupView> {
    const d = this.descriptorOrThrow(group)
    const known = new Set(d.fields.map((f) => f.key))
    for (const k of Object.keys(fields)) {
      if (!known.has(k)) {
        throw new AppException(HttpStatus.BAD_REQUEST, `Unknown field for group ${group}: ${k}`, ERROR_CODES.VALIDATION_ERROR)
      }
    }

    const existing = await this.repo.findActive(tenantId, group, level, scopeId)
    const prevPayload = existing?.payload ?? {}
    const nextPayload = { ...prevPayload, ...fields }

    // Guard: validate the EFFECTIVE values this scope produces (defaults ← parent overrides ← this).
    if (d.validate) {
      const parentPlant = level === 'plant' ? undefined : scopeId // plant resolves against tenant below
      const parentResolved = await this.resolve(group, tenantId, level === 'plant' ? undefined : parentPlant)
      const effective = { ...parentResolved.values, ...nextPayload }
      const verdict = d.validate(effective)
      if (!verdict.ok) {
        throw new AppException(HttpStatus.BAD_REQUEST, verdict.warnings.join('; ') || 'Config guard rejected this set', ERROR_CODES.VALIDATION_ERROR)
      }
    }

    const revision = (existing?.revision ?? 0) + 1
    if (existing) {
      await this.repo.update(existing.id, nextPayload, revision, userId)
    } else {
      await this.repo.insert({ tenantId, settingGroup: group, level, scopeId, payload: nextPayload, revision })
    }
    await this.auditChanges(group, level, scopeId, tenantId, prevPayload, nextPayload, revision, userId)

    return this.getGroupView(group, tenantId, level === 'plant' ? scopeId : undefined)
  }

  /**
   * Reset-to-parent: clear one field (or the whole level when `field` is omitted) so it cascades
   * from the parent again. Audits the cleared field(s) as old→null.
   * @throws AppException VALIDATION_ERROR - unknown group.
   */
  async resetToParent(
    group: ConfigGroupKey,
    level: 'tenant' | 'plant',
    scopeId: string,
    tenantId: string,
    field: string | undefined,
    userId: string | null,
  ): Promise<ConfigGroupView> {
    this.descriptorOrThrow(group)
    const existing = await this.repo.findActive(tenantId, group, level, scopeId)
    if (existing) {
      const prevPayload = existing.payload ?? {}
      if (field) {
        const nextPayload = { ...prevPayload }
        delete nextPayload[field]
        const revision = existing.revision + 1
        if (Object.keys(nextPayload).length === 0) {
          await this.repo.deactivate(existing.id, userId)
        } else {
          await this.repo.update(existing.id, nextPayload, revision, userId)
        }
        await this.auditChanges(group, level, scopeId, tenantId, prevPayload, nextPayload, revision, userId)
      } else {
        await this.repo.deactivate(existing.id, userId)
        await this.auditChanges(group, level, scopeId, tenantId, prevPayload, {}, existing.revision + 1, userId)
      }
    }
    return this.getGroupView(group, tenantId, level === 'plant' ? scopeId : undefined)
  }

  /** Emit one audit row per field whose value changed between two payloads. */
  private async auditChanges(
    group: ConfigGroupKey,
    level: 'tenant' | 'plant',
    scopeId: string,
    tenantId: string,
    prev: Record<string, ConfigValue>,
    next: Record<string, ConfigValue>,
    revision: number,
    userId: string | null,
  ): Promise<void> {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
    const rows = [...keys]
      .filter((k) => prev[k] !== next[k])
      .map((k) => ({
        tenantId,
        settingGroup: group,
        level,
        scopeId,
        field: k,
        oldValue: prev[k] ?? null,
        newValue: next[k] ?? null,
        revision,
        changedBy: userId,
      }))
    await this.repo.appendAudit(rows)
  }
}
