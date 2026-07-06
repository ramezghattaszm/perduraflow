import { HttpStatus, Injectable } from '@nestjs/common'
import {
  UNRESOLVABLE_PART_REF,
  type MakeBuy,
  type PartRefResolution,
  type PartVersionDto,
  type ReviseRoutingRequest,
  type RevisePartRequest,
  type RoutingVersionDto,
  type UomFactorDto,
  type UomFactorsDto,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { generateId } from '../../db/ulid'
import { toPartVersionDto, toRoutingVersionDto } from './master-data.mapper'
import { MasterDataRepository } from './master-data.repository'
import type {
  MasterDataAuditChange,
  MasterDataEntityType,
  NewMasterDataAudit,
  NewPart,
  NewPartPlant,
  NewPlantPartMapping,
  NewRouting,
  NewRoutingOperation,
  NewUomConversion,
  Part,
  PartPlant,
  PlantPartMapping,
  Routing,
} from './schema'

/** The overridable fields a per-plant override may set (§4E). `undefined` = leave/inherit prior; `null` = inherit the global part value. */
export interface PartPlantOverrideChanges {
  makeBuy?: MakeBuy | null
  material?: string | null
  gauge?: string | null
  colour?: string | null
  toolFamily?: string | null
  sharedAttributes?: Record<string, unknown> | null
}

/** The overridable columns carried on a part_plant window (for audit diffing). */
const PART_PLANT_OVERRIDE_COLS = ['makeBuy', 'material', 'gauge', 'colour', 'toolFamily', 'sharedAttributes'] as const

/** Part attributes carried across revisions (identity `part_no` excluded). Includes the Layer 1 §4A engineering fields. */
const PART_ATTR_COLS = [
  'description',
  'partType',
  'uom',
  'material',
  'gauge',
  'colour',
  'status',
  'makeBuy',
  'customerPartNo',
  'customerId',
  'program',
  'toolFamily',
  'sharedAttributes',
] as const
/** Routing header attributes carried across revisions (operations audited via the version's op rows). */
const ROUTING_ATTR_COLS = ['name', 'isPrimary', 'status'] as const

/**
 * Resolve-as-of + revise for the Pattern-A versioned entities (`part`, `routing`) — Layer 0 §5 / MD3.
 * Resolution follows the durable business key (`part_no`, `(part_no, name)`) at a point in time; a
 * revise is one transaction (close prior window → open new version → write audit). The scoped-DB
 * transaction lives in the repository (O2); this service owns the domain logic — window selection,
 * effectivity validation, and the audit-row shape.
 *
 * Window is half-open **`[effective_from, effective_to)`** — `effective_from <= asOf AND (effective_to
 * IS NULL OR effective_to > asOf)` — matching the GiST exclusion constraint's `tstzrange`.
 *
 * `revise*` is **native-SoR only** (no external-connector guard needed until a connector exists) and
 * must be called behind `configure`/master-data-admin authorization when exposed over transport.
 */
@Injectable()
export class MasterDataResolver {
  constructor(private readonly repo: MasterDataRepository) {}

  // --- resolve-as-of ---------------------------------------------------------
  /**
   * The part version effective at `asOf` (default now) for `partNo`, or null. When `plantId` is given,
   * the window-containing per-plant override (§4E) is layered on: a non-null override column wins over
   * the global value; `shared_attributes` shallow key-merges. **When `plantId` is omitted the result is
   * the pure global version — byte-identical to the pre-override behavior, with no extra query.**
   */
  async resolvePart(
    tenantId: string,
    partNo: string,
    opts: { plantId?: string; asOf?: string } = {},
  ): Promise<PartVersionDto | null> {
    const at = opts.asOf ? new Date(opts.asOf) : new Date()
    const row = await this.repo.findPartAsOf(tenantId, partNo, at)
    if (!row) return null
    if (!opts.plantId) return toPartVersionDto(row) // pure global — inert when no plant scope
    const override = await this.repo.findPartPlantAsOf(tenantId, partNo, opts.plantId, at)
    return toPartVersionDto(override ? this.applyPartPlantOverride(row, override) : row)
  }

  /** Full revision history for `partNo`, oldest first. */
  async resolvePartVersions(tenantId: string, partNo: string): Promise<PartVersionDto[]> {
    return (await this.repo.listPartVersions(tenantId, partNo)).map(toPartVersionDto)
  }

  /** Reads one EXACT part version by row id (a frozen-snapshot read: `scheduled_operation.part_id`), or null. Non-deprecated. */
  async getPartVersion(tenantId: string, versionId: string): Promise<PartVersionDto | null> {
    const row = await this.repo.findPart(tenantId, versionId)
    return row ? toPartVersionDto(row) : null
  }

  // --- uom factor publication (§4B / MD4) ------------------------------------
  /**
   * Publishes the UoM conversion factors for the part **version effective at `asOf`** (default now):
   * its `uom` as `baseUom` plus the factor rows bound to that version (`alt_qty × factor = base_qty`).
   * Returns null when no version resolves. Master Data publishes; consumers convert at their own boundary.
   */
  async getUomFactors(tenantId: string, partNo: string, asOf?: string): Promise<UomFactorsDto | null> {
    const at = asOf ? new Date(asOf) : new Date()
    const version = await this.repo.findPartAsOf(tenantId, partNo, at)
    if (!version) return null
    const rows = await this.repo.listUomConversions(tenantId, version.id)
    return { baseUom: version.uom, factors: rows.map((r) => ({ alternateUom: r.alternateUom, factor: r.factor })) }
  }

  /**
   * Publishes (upserts) one UoM factor onto a specific part **version**. The `base_uom` invariant is
   * enforced here — `base_uom` is taken from the version's own `uom`, never the caller — so a factor can
   * only ever describe a conversion into the version's base unit.
   * @throws AppException PART_NOT_FOUND - no such part version
   * @throws AppException VALIDATION_ERROR - `alternateUom` equals the base UoM, or `factor` is not a positive finite number
   */
  async addUomFactor(tenantId: string, partVersionId: string, alternateUom: string, factor: number): Promise<UomFactorDto> {
    const version = await this.repo.findPart(tenantId, partVersionId)
    if (!version) throw new AppException(HttpStatus.NOT_FOUND, 'No such part version', ERROR_CODES.PART_NOT_FOUND)
    if (alternateUom === version.uom) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'alternate_uom must differ from the base uom', ERROR_CODES.VALIDATION_ERROR)
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'factor must be a positive number', ERROR_CODES.VALIDATION_ERROR)
    }
    const row = await this.repo.upsertUomConversion({ tenantId, partId: partVersionId, alternateUom, baseUom: version.uom, factor })
    return { alternateUom: row.alternateUom, factor: row.factor }
  }

  // --- part_plant override write (§4E) ---------------------------------------
  /**
   * Sets a per-plant override window for `(partNo, plantId)` — create-or-revise, transactional + audited.
   * When an open window already exists it is closed at `effectiveFrom` (strictly after its start) and a
   * new window opened, inheriting the prior override columns unless the `changes` set them (a `revise` +
   * `supersede` audit pair). Otherwise a fresh window is opened (a `create` audit row). `effectiveFrom`
   * defaults to now. Plant validity is asserted by the caller (service, via org.read — O4).
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - explicit `effectiveFrom` not after the open window's
   */
  async revisePartPlant(
    tenantId: string,
    partNo: string,
    plantId: string,
    input: { effectiveFrom?: string; changes: PartPlantOverrideChanges },
    actor: string,
  ): Promise<PartPlant> {
    const prior = await this.repo.findOpenPartPlant(tenantId, partNo, plantId)
    const effectiveFrom = prior
      ? this.assertAfter(input.effectiveFrom ?? new Date().toISOString(), prior.effectiveFrom)
      : input.effectiveFrom
        ? new Date(input.effectiveFrom)
        : new Date()

    const c = input.changes
    const pick = <T>(next: T | undefined, priorVal: T | null | undefined): T | null =>
      next !== undefined ? next : (priorVal ?? null)
    const newRow: NewPartPlant = {
      id: generateId(),
      tenantId,
      partNo,
      plantId,
      makeBuy: pick(c.makeBuy, prior?.makeBuy),
      material: pick(c.material, prior?.material),
      gauge: pick(c.gauge, prior?.gauge),
      colour: pick(c.colour, prior?.colour),
      toolFamily: pick(c.toolFamily, prior?.toolFamily),
      sharedAttributes: pick(c.sharedAttributes, prior?.sharedAttributes),
      effectiveFrom,
      effectiveTo: null,
      supersedesId: prior?.id ?? null,
    }

    let auditRows: NewMasterDataAudit[]
    if (prior) {
      const changedFields = this.diffAttrs(prior, newRow, PART_PLANT_OVERRIDE_COLS)
      changedFields['supersedesId'] = { new: prior.id }
      auditRows = this.reviseAuditRows({
        tenantId,
        entityType: 'part_plant',
        businessKey: partNo,
        newId: newRow.id!,
        priorId: prior.id,
        priorEffectiveFrom: prior.effectiveFrom,
        effectiveFrom,
        actor,
        sourceRef: null,
        changedFields,
      })
    } else {
      const changedFields: Record<string, MasterDataAuditChange> = { plantId: { new: plantId } }
      for (const col of PART_PLANT_OVERRIDE_COLS) {
        const v = (newRow as Record<string, unknown>)[col] ?? null
        if (v !== null) changedFields[col] = { new: v }
      }
      auditRows = [
        {
          tenantId,
          entityType: 'part_plant',
          businessKey: partNo,
          versionId: newRow.id!,
          action: 'create',
          actor,
          sourceRef: null,
          effectiveFrom,
          changedFields,
        },
      ]
    }

    return this.repo.revisePartPlantTx({ tenantId, priorId: prior?.id, effectiveFrom, newRow, auditRows })
  }

  /**
   * Layers a per-plant override onto the resolved global part version (§4E): a non-null override column
   * wins over the global; a `null` override column inherits the global. `shared_attributes` shallow
   * key-merges (see {@link mergeSharedAttributes}). Identity/versioning columns are never overridden.
   */
  private applyPartPlantOverride(global: Part, o: PartPlant): Part {
    return {
      ...global,
      makeBuy: o.makeBuy ?? global.makeBuy,
      material: o.material ?? global.material,
      gauge: o.gauge ?? global.gauge,
      colour: o.colour ?? global.colour,
      toolFamily: o.toolFamily ?? global.toolFamily,
      sharedAttributes: this.mergeSharedAttributes(global.sharedAttributes, o.sharedAttributes),
    }
  }

  /**
   * Shallow key-merge `{ ...global, ...plant }` for `shared_attributes`: a plant key overrides the global
   * value; a plant key absent from the global is added; a plant value of `null` **inherits** (not delete);
   * nested objects replace wholesale (no deep merge). A null plant map inherits the global map wholesale.
   */
  private mergeSharedAttributes(
    global: Record<string, unknown> | null,
    plant: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (plant == null) return global
    const out: Record<string, unknown> = { ...(global ?? {}) }
    for (const [k, v] of Object.entries(plant)) {
      if (v === null) continue // null = inherit, not delete
      out[k] = v // override / add; nested objects replace wholesale
    }
    return out
  }

  // --- MD9 part-reference resolution (§4D) ------------------------------------
  /**
   * Resolves a plant-local alias `(plantId, plantPartNo)` to a global `part_no` as-of `asOf` (default now).
   * Returns the typed {@link UNRESOLVABLE_PART_REF} sentinel when no mapping window covers the instant —
   * never a null or a guess (D-MD9; the exception queue is Layer 3).
   */
  async resolvePlantPart(tenantId: string, plantId: string, plantPartNo: string, asOf?: string): Promise<PartRefResolution> {
    const at = asOf ? new Date(asOf) : new Date()
    const mapping = await this.repo.findPlantPartMappingAsOf(tenantId, plantId, plantPartNo, at)
    return mapping ? { partNo: mapping.partNo } : UNRESOLVABLE_PART_REF
  }

  /**
   * Resolves a customer reference `(customerId, customerPartNo)` to a global `part_no` as-of `asOf`
   * (default now) — queries the inline `customer_id`/`customer_part_no` part fields (they ride the
   * revision, so this is windowed). Returns {@link UNRESOLVABLE_PART_REF} when nothing matches.
   */
  async resolveCustomerPart(tenantId: string, customerId: string, customerPartNo: string, asOf?: string): Promise<PartRefResolution> {
    const at = asOf ? new Date(asOf) : new Date()
    const row = await this.repo.findPartByCustomerRefAsOf(tenantId, customerId, customerPartNo, at)
    return row ? { partNo: row.partNo } : UNRESOLVABLE_PART_REF
  }

  /**
   * Sets a plant-local mapping window for `(plantId, plantPartNo) → partNo` — create-or-revise,
   * transactional + audited. An existing open window is closed at `effectiveFrom` (strictly after its
   * start) and a new one opened (`revise` + `supersede`); otherwise a fresh window is opened (`create`).
   * `effectiveFrom` defaults to now. Plant + target-part validity are asserted by the caller (service, O4).
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - explicit `effectiveFrom` not after the open window's
   */
  async revisePlantPartMapping(
    tenantId: string,
    plantId: string,
    plantPartNo: string,
    input: { partNo: string; effectiveFrom?: string },
    actor: string,
  ): Promise<PlantPartMapping> {
    const prior = await this.repo.findOpenPlantPartMapping(tenantId, plantId, plantPartNo)
    const effectiveFrom = prior
      ? this.assertAfter(input.effectiveFrom ?? new Date().toISOString(), prior.effectiveFrom)
      : input.effectiveFrom
        ? new Date(input.effectiveFrom)
        : new Date()

    const newRow: NewPlantPartMapping = {
      id: generateId(),
      tenantId,
      plantId,
      plantPartNo,
      partNo: input.partNo,
      effectiveFrom,
      effectiveTo: null,
      supersedesId: prior?.id ?? null,
    }

    let auditRows: NewMasterDataAudit[]
    if (prior) {
      const changedFields: Record<string, MasterDataAuditChange> = {}
      if (prior.partNo !== input.partNo) changedFields['partNo'] = { old: prior.partNo, new: input.partNo }
      changedFields['supersedesId'] = { new: prior.id }
      auditRows = this.reviseAuditRows({
        tenantId,
        entityType: 'plant_part_mapping',
        businessKey: plantPartNo,
        newId: newRow.id!,
        priorId: prior.id,
        priorEffectiveFrom: prior.effectiveFrom,
        effectiveFrom,
        actor,
        sourceRef: null,
        changedFields,
      })
    } else {
      auditRows = [
        {
          tenantId,
          entityType: 'plant_part_mapping',
          businessKey: plantPartNo,
          versionId: newRow.id!,
          action: 'create',
          actor,
          sourceRef: null,
          effectiveFrom,
          changedFields: { plantId: { new: plantId }, plantPartNo: { new: plantPartNo }, partNo: { new: input.partNo } },
        },
      ]
    }

    return this.repo.revisePlantPartMappingTx({ tenantId, priorId: prior?.id, effectiveFrom, newRow, auditRows })
  }

  /** The routing version effective at `asOf` (default now) for `partNo` (with operations), or null. */
  async resolveRouting(
    tenantId: string,
    partNo: string,
    opts: { name?: string; primaryOnly?: boolean; asOf?: string } = {},
  ): Promise<RoutingVersionDto | null> {
    const at = opts.asOf ? new Date(opts.asOf) : new Date()
    const row = await this.repo.findRoutingAsOf(tenantId, partNo, {
      name: opts.name,
      primaryOnly: opts.primaryOnly,
      asOf: at,
    })
    if (!row) return null
    return toRoutingVersionDto(row, await this.repo.operationsFor(row.id))
  }

  // --- revise (transactional: close prior → open new → audit) ----------------
  /**
   * Creates a new part revision. Transactional in the repository.
   * @throws AppException PART_NOT_FOUND - no open version of `partNo` to revise
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - `effectiveFrom` not strictly after the open version's
   */
  async revisePart(tenantId: string, partNo: string, input: RevisePartRequest, actor: string): Promise<PartVersionDto> {
    const prior = await this.repo.findOpenPart(tenantId, partNo)
    if (!prior) throw new AppException(HttpStatus.NOT_FOUND, 'No open part version to revise', ERROR_CODES.PART_NOT_FOUND)
    const effectiveFrom = this.assertAfter(input.effectiveFrom, prior.effectiveFrom)

    const c = input.changes
    const newVersion: NewPart = {
      id: generateId(),
      tenantId,
      partNo,
      description: c.description !== undefined ? c.description : prior.description,
      partType: c.partType ?? prior.partType,
      uom: c.uom ?? prior.uom,
      material: c.material !== undefined ? c.material : prior.material,
      gauge: c.gauge !== undefined ? c.gauge : prior.gauge,
      colour: c.colour !== undefined ? c.colour : prior.colour,
      status: c.status ?? prior.status,
      // Layer 1 §4A/§4C engineering fields — copied forward from the prior version unless the revise changes them.
      makeBuy: c.makeBuy ?? prior.makeBuy,
      customerPartNo: c.customerPartNo !== undefined ? c.customerPartNo : prior.customerPartNo,
      customerId: c.customerId !== undefined ? c.customerId : prior.customerId,
      program: c.program !== undefined ? c.program : prior.program,
      toolFamily: c.toolFamily !== undefined ? c.toolFamily : prior.toolFamily,
      sharedAttributes: c.sharedAttributes !== undefined ? c.sharedAttributes : prior.sharedAttributes,
      revision: input.revision,
      effectiveFrom,
      effectiveTo: null,
      supersedesId: prior.id,
    }
    const changedFields = this.diffAttrs(prior, newVersion, PART_ATTR_COLS)
    changedFields['revision'] = { old: prior.revision, new: input.revision }
    changedFields['supersedesId'] = { new: prior.id }

    // Guarded copy-forward of UoM factors (§4B / MD4): factors ride the part version, but their invariant
    // is `base_uom = this version's uom`. If the revise changes `uom`, the prior factors' base no longer
    // holds — do NOT blindly inherit; drop them so the new version has none and the change is surfaced in
    // the audit trail for re-examination (never a silent copy). Otherwise rebind each row to the new id.
    const priorFactors = await this.repo.listUomConversions(tenantId, prior.id)
    const baseUomUnchanged = newVersion.uom === prior.uom
    const uomFactors: NewUomConversion[] = baseUomUnchanged
      ? priorFactors.map((f) => ({
          tenantId,
          partId: newVersion.id!,
          alternateUom: f.alternateUom,
          baseUom: newVersion.uom,
          factor: f.factor,
        }))
      : []
    if (priorFactors.length > 0 && !baseUomUnchanged) {
      // Flag: base UoM changed → factors NOT inherited (re-examine and re-publish against the new base).
      changedFields['uomFactors'] = { old: priorFactors.length, new: 0 }
    }

    const auditRows = this.reviseAuditRows({
      tenantId,
      entityType: 'part',
      businessKey: partNo,
      newId: newVersion.id!,
      priorId: prior.id,
      priorEffectiveFrom: prior.effectiveFrom,
      effectiveFrom,
      actor,
      sourceRef: input.ecnRef,
      changedFields,
    })

    const newRow = await this.repo.revisePartTx({ tenantId, priorId: prior.id, effectiveFrom, newVersion, auditRows, uomFactors })
    return toPartVersionDto(newRow)
  }

  /**
   * Creates a new routing revision (copies the prior op rows onto the new version, unless `changes.operations`
   * replaces them). Transactional in the repository.
   * @throws AppException ROUTING_NOT_FOUND - no open routing to revise for `partNo`
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - `effectiveFrom` not strictly after the open version's
   */
  async reviseRouting(tenantId: string, partNo: string, input: ReviseRoutingRequest, actor: string): Promise<RoutingVersionDto> {
    const select = input.name ? { name: input.name } : { primaryOnly: true }
    const prior = await this.repo.findOpenRouting(tenantId, partNo, select)
    if (!prior) throw new AppException(HttpStatus.NOT_FOUND, 'No open routing to revise', ERROR_CODES.ROUTING_NOT_FOUND)
    const effectiveFrom = this.assertAfter(input.effectiveFrom, prior.effectiveFrom)

    const c = input.changes
    const newVersion: NewRouting = {
      id: generateId(),
      tenantId,
      partNo,
      name: c.name ?? prior.name,
      isPrimary: c.isPrimary ?? prior.isPrimary,
      status: c.status ?? prior.status,
      revision: input.revision,
      effectiveFrom,
      effectiveTo: null,
      supersedesId: prior.id,
    }

    // Operations: replace with the supplied set, or copy the prior version's rows forward.
    const sourceOps = c.operations
      ? c.operations
      : (await this.repo.operationsFor(prior.id)).map((o) => ({
          opSeq: o.opSeq,
          resourceGroupId: o.resourceGroupId,
          stdSetupTime: o.stdSetupTime,
          stdCycleTime: o.stdCycleTime,
          changeoverAttributeKey: o.changeoverAttributeKey,
        }))
    const operations: Omit<NewRoutingOperation, 'routingId'>[] = sourceOps.map((o) => ({
      tenantId,
      opSeq: o.opSeq,
      resourceGroupId: o.resourceGroupId,
      stdSetupTime: o.stdSetupTime,
      stdCycleTime: o.stdCycleTime,
      changeoverAttributeKey: o.changeoverAttributeKey ?? null,
    }))

    const changedFields = this.diffAttrs(prior, newVersion, ROUTING_ATTR_COLS)
    changedFields['revision'] = { old: prior.revision, new: input.revision }
    changedFields['supersedesId'] = { new: prior.id }
    if (c.operations) changedFields['operations'] = { new: operations.length }

    const auditRows = this.reviseAuditRows({
      tenantId,
      entityType: 'routing',
      businessKey: partNo,
      newId: newVersion.id!,
      priorId: prior.id,
      priorEffectiveFrom: prior.effectiveFrom,
      effectiveFrom,
      actor,
      sourceRef: input.ecnRef,
      changedFields,
    })

    const newRow = await this.repo.reviseRoutingTx({ tenantId, priorId: prior.id, effectiveFrom, newVersion, operations, auditRows })
    return toRoutingVersionDto(newRow, await this.repo.operationsFor(newRow.id))
  }

  // --- internals -------------------------------------------------------------
  /** Parse + validate: the new window must open strictly after the current open version's start. */
  private assertAfter(effectiveFromIso: string, priorEffectiveFrom: Date): Date {
    const effectiveFrom = new Date(effectiveFromIso)
    if (!(effectiveFrom.getTime() > priorEffectiveFrom.getTime())) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "A revision's effective_from must be strictly after the current version's",
        ERROR_CODES.INVALID_REVISION_EFFECTIVE_FROM,
      )
    }
    return effectiveFrom
  }

  /** Old→new for the tracked columns that actually changed; unchanged columns omitted. */
  private diffAttrs(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    cols: readonly string[],
  ): Record<string, MasterDataAuditChange> {
    const out: Record<string, MasterDataAuditChange> = {}
    for (const col of cols) {
      const old = before[col] ?? null
      const next = after[col] ?? null
      if (old !== next) out[col] = { old, new: next }
    }
    return out
  }

  /**
   * The two audit rows a revise writes (Layer 0 §6 mapping): `revise` on the NEW version (the changed
   * attributes + revision/supersedesId, stamped with the new window start) and `supersede` on the PRIOR
   * version (its window was closed at `effectiveFrom`). Both carry the ECN/ECR `sourceRef`.
   */
  private reviseAuditRows(p: {
    tenantId: string
    entityType: MasterDataEntityType
    businessKey: string
    newId: string
    priorId: string
    priorEffectiveFrom: Date
    effectiveFrom: Date
    actor: string
    sourceRef: string | null
    changedFields: Record<string, MasterDataAuditChange>
  }): NewMasterDataAudit[] {
    return [
      {
        tenantId: p.tenantId,
        entityType: p.entityType,
        businessKey: p.businessKey,
        versionId: p.newId,
        action: 'revise',
        actor: p.actor,
        sourceRef: p.sourceRef,
        effectiveFrom: p.effectiveFrom,
        changedFields: p.changedFields,
      },
      {
        tenantId: p.tenantId,
        entityType: p.entityType,
        businessKey: p.businessKey,
        versionId: p.priorId,
        action: 'supersede',
        actor: p.actor,
        sourceRef: p.sourceRef,
        effectiveFrom: p.priorEffectiveFrom,
        changedFields: { effectiveTo: { old: null, new: p.effectiveFrom.toISOString() } },
      },
    ]
  }
}
