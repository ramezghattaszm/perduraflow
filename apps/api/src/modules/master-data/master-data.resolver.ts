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
  Bom,
  BomComponent,
  MasterDataAuditChange,
  MasterDataEntityType,
  NewBom,
  NewBomComponent,
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

/** One draft edge input for {@link MasterDataResolver.reviseBom}. `qtyPer`/`scrapPct` are exact decimal STRINGS (numeric). */
export interface BomComponentInput {
  componentPartNo: string
  qtyPer: string
  scrapPct?: string | null
}

/** Author/update input for a draft BOM. */
export interface ReviseBomInput {
  revision?: string
  components: BomComponentInput[]
}

/** A resolved BOM version + its edges (the read shape until the `bom.read` DTOs land). */
export interface ResolvedBom {
  bom: Bom
  components: BomComponent[]
}

/** One node of a BOM explosion — a component occurrence at a depth. **Topology only — no quantities.** */
export interface BomExplosionNode {
  partNo: string
  /** Depth: the root's direct components are `1`, their components `2`, … (derived by the walk). */
  level: number
  /** The immediate parent of this occurrence in the explosion. */
  parentPartNo: string
  /** No further BOM as-of (a buy/leaf component) — the branch terminates here. */
  isLeaf: boolean
  /** This occurrence closed a cycle (it re-entered an ancestor); the walk terminated here, never recursed. */
  cyclic?: boolean
}

/** A detected BOM cycle — the ancestor path that closed back on itself (a structured finding, not a hang). */
export interface BomCycle {
  path: string[]
}

/** The multi-level explosion of a BOM (topology + any cycle findings). */
export interface BomExplosion {
  parentPartNo: string
  nodes: BomExplosionNode[]
  cycles: BomCycle[]
}

/** One where-used occurrence — `partNo` consumes `childPartNo`; `level` steps up (1 = direct parent). */
export interface WhereUsedParent {
  partNo: string
  level: number
  childPartNo: string
}

export interface WhereUsedResult {
  componentPartNo: string
  parents: WhereUsedParent[]
}

/** A BOM integrity failure kind (D-L2-6) — topology only, no plan quantities. */
export type BomIntegrityKind = 'COMPONENT_NOT_FOUND' | 'CYCLE' | 'EFFECTIVITY_INCONSISTENT' | 'MAKE_BUY_INCOHERENT'

/** One structured integrity finding (an author-facing reason a BOM is invalid). */
export interface BomIntegrityFinding {
  kind: BomIntegrityKind
  /** The offending component (component-level findings). */
  component?: string
  /** The ancestor path that closed a cycle (`CYCLE`). */
  path?: string[]
  detail: string
}

/** Result of {@link MasterDataResolver.validateBomIntegrity} — `ok` + the findings (empty when valid). */
export interface BomIntegrityResult {
  parentPartNo: string
  ok: boolean
  findings: BomIntegrityFinding[]
}

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
    // THE factor-as-string boundary (§4B): `r.factor` is node-postgres' native exact decimal STRING
    // (no global OID-1700 parser). Narrowing to a JS `number` for the DTO happens here and ONLY here —
    // the single, documented precision cliff. First-class exact-decimal computation is a logged future item.
    return { baseUom: version.uom, factors: rows.map((r) => ({ alternateUom: r.alternateUom, factor: Number(r.factor) })) }
  }

  /**
   * Publishes (upserts) one UoM factor onto a specific part **version**. The `base_uom` invariant is
   * enforced here — `base_uom` is taken from the version's own `uom`, never the caller — so a factor can
   * only ever describe a conversion into the version's base unit.
   * `factor` is a **decimal STRING** (never a JS number on the way in) — stored raw into the `numeric`
   * column, so the write path is exact end-to-end, matching the storage + native-string read (§4B). It
   * must be a positive decimal literal (validated at the contract edge; re-guarded here for direct callers).
   * @throws AppException PART_NOT_FOUND - no such part version
   * @throws AppException VALIDATION_ERROR - `alternateUom` equals the base UoM, or `factor` is not a positive decimal string
   */
  async addUomFactor(tenantId: string, partVersionId: string, alternateUom: string, factor: string, actor = 'system'): Promise<UomFactorDto> {
    const version = await this.repo.findPart(tenantId, partVersionId)
    if (!version) throw new AppException(HttpStatus.NOT_FOUND, 'No such part version', ERROR_CODES.PART_NOT_FOUND)
    if (alternateUom === version.uom) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'alternate_uom must differ from the base uom', ERROR_CODES.VALIDATION_ERROR)
    }
    // Positive-decimal check on the STRING itself — no JS-number parse, so the submitted digits are never
    // rounded. A non-negative decimal literal with at least one non-zero digit is > 0.
    if (!/^\d+(\.\d+)?$/.test(factor) || !/[1-9]/.test(factor)) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'factor must be a positive decimal string', ERROR_CODES.VALIDATION_ERROR)
    }
    const existing = await this.repo.findUomConversion(tenantId, partVersionId, alternateUom)
    const auditRow: NewMasterDataAudit = {
      tenantId,
      entityType: 'uom_conversion',
      businessKey: partVersionId,
      versionId: existing?.id ?? generateId(),
      action: existing ? 'update' : 'create',
      actor,
      sourceRef: null,
      effectiveFrom: null,
      changedFields: existing
        ? { factor: { old: existing.factor, new: factor } }
        : { alternateUom: { new: alternateUom }, baseUom: { new: version.uom }, factor: { new: factor } },
    }
    // Store the exact decimal string RAW — no String()/Number() round-trip on the way in.
    const row = await this.repo.upsertUomConversionWithAudit(
      { tenantId, partId: partVersionId, alternateUom, baseUom: version.uom, factor },
      auditRow,
    )
    // The return DTO narrows to a number at the read boundary (the one documented precision cliff); the
    // STORED value is exact. Making the DTO itself exact-decimal is the logged future item.
    return { alternateUom: row.alternateUom, factor: Number(row.factor) }
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

  // --- bom draft/publish (Layer 2 §4a.2, D-L2-2) -----------------------------
  /**
   * Author/update the DRAFT BOM for a parent — create the one open draft or replace the existing draft's
   * edges (transactional, audited). Drafts carry NO window and are invisible to {@link resolveBom}. The
   * one-open-draft invariant is upheld by upserting the single draft (and enforced at the DB by a partial
   * unique index). `qtyPer`/`scrapPct` are stored as their exact decimal strings (`numeric`).
   */
  async reviseBom(tenantId: string, parentPartNo: string, input: ReviseBomInput, actor: string): Promise<Bom> {
    const existing = await this.repo.findOpenDraftBom(tenantId, parentPartNo)
    const revision = input.revision ?? existing?.revision ?? 'A'
    const header: NewBom = existing
      ? { id: existing.id, tenantId, parentPartNo, revision, status: 'draft' }
      : { id: generateId(), tenantId, parentPartNo, revision, status: 'draft', effectiveFrom: null, effectiveTo: null }
    const components: Omit<NewBomComponent, 'bomId'>[] = input.components.map((c) => ({
      tenantId,
      componentPartNo: c.componentPartNo,
      qtyPer: c.qtyPer,
      scrapPct: c.scrapPct ?? null,
    }))
    const versionId = header.id!
    const auditRows: NewMasterDataAudit[] = [
      {
        tenantId,
        entityType: 'bom',
        businessKey: parentPartNo,
        versionId,
        action: existing ? 'update' : 'create',
        actor,
        sourceRef: null,
        effectiveFrom: null,
        changedFields: { revision: { new: revision }, components: { new: components.length } },
      },
    ]
    return this.repo.reviseBomTx({ tenantId, draftId: existing?.id, header, components, auditRows })
  }

  /**
   * Publish the open draft for a parent as-of `effectiveFrom`: run the integrity gate (blocking), close the
   * prior open published version (→ superseded), flip the draft → published with an open window +
   * `supersedes_id`, write audit — all atomic. The one-open-published invariant is upheld by closing the
   * prior (and enforced at the DB by a partial unique index + GiST non-overlap on non-draft windows).
   * @throws AppException BOM_NOT_FOUND - no open draft to publish
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - `effectiveFrom` not strictly after the prior published's
   */
  async publishBom(tenantId: string, parentPartNo: string, effectiveFromIso: string, actor: string): Promise<Bom> {
    const draft = await this.repo.findOpenDraftBom(tenantId, parentPartNo)
    if (!draft) throw new AppException(HttpStatus.NOT_FOUND, 'No open BOM draft to publish', ERROR_CODES.BOM_NOT_FOUND)

    const prior = await this.repo.findOpenPublishedBom(tenantId, parentPartNo)
    const effectiveFrom = prior
      ? this.assertAfter(effectiveFromIso, prior.effectiveFrom!)
      : new Date(effectiveFromIso)

    // Integrity gate (D-L2-6) — BLOCKING: an invalid BOM cannot publish. Checked as-of the window start.
    const integrity = await this.validateBomIntegrity(tenantId, parentPartNo, effectiveFrom.toISOString())
    if (!integrity.ok) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        `BOM integrity failed: ${integrity.findings.map((f) => f.detail).join('; ')}`,
        ERROR_CODES.INVALID_BOM,
      )
    }

    const auditRows: NewMasterDataAudit[] = [
      {
        tenantId,
        entityType: 'bom',
        businessKey: parentPartNo,
        versionId: draft.id,
        action: 'revise', // the draft opens its effectivity window (becomes the live version)
        actor,
        sourceRef: null,
        effectiveFrom,
        changedFields: { status: { old: 'draft', new: 'published' }, ...(prior ? { supersedesId: { new: prior.id } } : {}) },
      },
    ]
    if (prior) {
      auditRows.push({
        tenantId,
        entityType: 'bom',
        businessKey: parentPartNo,
        versionId: prior.id,
        action: 'supersede',
        actor,
        sourceRef: null,
        effectiveFrom: prior.effectiveFrom,
        changedFields: { status: { old: 'published', new: 'superseded' }, effectiveTo: { old: null, new: effectiveFrom.toISOString() } },
      })
    }
    return this.repo.publishBomTx({ tenantId, draftId: draft.id, priorPublishedId: prior?.id, effectiveFrom, auditRows })
  }

  /**
   * The BOM version effective at `asOf` (default now) for a parent + its edges, or null. Returns the open
   * published version for `asOf = now`, or a superseded version whose closed window contains a historical
   * `asOf` (reconstruction). Drafts never resolve (no window).
   */
  async resolveBom(tenantId: string, parentPartNo: string, asOf?: string): Promise<ResolvedBom | null> {
    const at = asOf ? new Date(asOf) : new Date()
    const version = await this.repo.findBomAsOf(tenantId, parentPartNo, at)
    if (!version) return null
    return { bom: version, components: await this.repo.bomComponentsFor(version.id) }
  }

  /**
   * Multi-level BOM explosion (Layer 2 §4a.2, D-L2-1) — recursively resolves each component's OWN published
   * BOM as-of and derives its `level` (root's direct components = 1). A component with no resolvable BOM
   * (buy/leaf) terminates the branch. **Cycle-safe:** the ancestor path is tracked per branch; a component
   * that re-enters its own ancestry is recorded as a structured {@link BomCycle} finding and terminates
   * that branch — never an infinite loop. **Topology only — no quantities.** As-of resolution runs at EACH
   * level (a historical `asOf` reconstructs the tree that was live then, not just the root).
   */
  async explodeBom(tenantId: string, parentPartNo: string, asOf?: string): Promise<BomExplosion> {
    const at = asOf ? new Date(asOf) : new Date()
    const nodes: BomExplosionNode[] = []
    const cycles: BomCycle[] = []
    // Returns whether `partNo` had a resolvable BOM (so the caller can mark leaves). `path` = the ancestor
    // chain INCLUDING `partNo`, used for cycle detection (a diamond re-uses a node but is not a cycle).
    const explode = async (partNo: string, level: number, path: Set<string>): Promise<boolean> => {
      const version = await this.repo.findBomAsOf(tenantId, partNo, at)
      if (!version) return false // buy/leaf — no published BOM as-of
      for (const edge of await this.repo.bomComponentsFor(version.id)) {
        const comp = edge.componentPartNo
        if (path.has(comp)) {
          cycles.push({ path: [...path, comp] })
          nodes.push({ partNo: comp, level, parentPartNo: partNo, isLeaf: true, cyclic: true })
          continue // terminate this branch — never recurse into the cycle
        }
        const node: BomExplosionNode = { partNo: comp, level, parentPartNo: partNo, isLeaf: true }
        nodes.push(node)
        const childHadBom = await explode(comp, level + 1, new Set([...path, comp]))
        node.isLeaf = !childHadBom
      }
      return true
    }
    await explode(parentPartNo, 1, new Set([parentPartNo]))
    return { parentPartNo, nodes, cycles }
  }

  /**
   * Where-used (Layer 2 §4a.2) — the parents that consume `componentPartNo`, traversing UP the structure
   * as-of: direct parents (`level` 1), then their parents (`level` 2), … Cycle-safe (an ancestor is never
   * re-ascended). **Topology only — no quantities.**
   */
  async whereUsed(tenantId: string, componentPartNo: string, asOf?: string): Promise<WhereUsedResult> {
    const at = asOf ? new Date(asOf) : new Date()
    const parents: WhereUsedParent[] = []
    const walkUp = async (comp: string, level: number, path: Set<string>): Promise<void> => {
      for (const parent of await this.repo.findBomParentsOf(tenantId, comp, at)) {
        if (path.has(parent)) continue // cycle — stop
        parents.push({ partNo: parent, level, childPartNo: comp })
        await walkUp(parent, level + 1, new Set([...path, parent]))
      }
    }
    await walkUp(componentPartNo, 1, new Set([componentPartNo]))
    return { componentPartNo, parents }
  }

  /**
   * BOM integrity validation (Layer 2 §4a.2, D-L2-6) — **topology only, no plan quantities**. Validates the
   * DRAFT for a parent (an author checking before publish), or the published version effective at `asOf`
   * when there is no draft. Structured findings for: (1) every component resolves to a part; (2) acyclic
   * (the 2a.2 ancestor-path cycle detection, seeded with the parent); (3) effectivity consistency (a `make`
   * component whose recipe exists but is NOT effective at the reference point — an effectivity gap); (4)
   * make/buy coherence (a `buy` component must not carry its own BOM — a purchased part has no recipe).
   * Runs BLOCKING on `publishBom` and is exposed here on-demand. `asOf` defaults to now; publish passes the
   * intended `effectiveFrom` (the window the BOM is about to open at).
   */
  async validateBomIntegrity(tenantId: string, parentPartNo: string, asOf?: string): Promise<BomIntegrityResult> {
    const at = asOf ? new Date(asOf) : new Date()
    const target = (await this.repo.findOpenDraftBom(tenantId, parentPartNo)) ?? (await this.repo.findBomAsOf(tenantId, parentPartNo, at))
    if (!target) return { parentPartNo, ok: true, findings: [] } // nothing to validate
    const findings = await this.checkBomIntegrity(tenantId, target, at)
    return { parentPartNo, ok: findings.length === 0, findings }
  }

  /** The integrity findings for a specific BOM version's edges (topology, as-of `at`). */
  private async checkBomIntegrity(tenantId: string, version: Bom, at: Date): Promise<BomIntegrityFinding[]> {
    const findings: BomIntegrityFinding[] = []
    const edges = await this.repo.bomComponentsFor(version.id)

    for (const e of edges) {
      const comp = e.componentPartNo
      const part = await this.repo.findPartAsOf(tenantId, comp, at)
      if (!part) {
        findings.push({ kind: 'COMPONENT_NOT_FOUND', component: comp, detail: `Component ${comp} does not resolve to a part as-of` })
        continue // no part → can't assess make/buy or effectivity
      }
      const childBomAsOf = await this.repo.findBomAsOf(tenantId, comp, at)
      if (part.makeBuy === 'buy' && childBomAsOf) {
        findings.push({ kind: 'MAKE_BUY_INCOHERENT', component: comp, detail: `Buy component ${comp} has its own BOM (a purchased part has no recipe)` })
      }
      if (part.makeBuy === 'make' && !childBomAsOf && (await this.repo.hasAnyPublishedBom(tenantId, comp))) {
        findings.push({ kind: 'EFFECTIVITY_INCONSISTENT', component: comp, detail: `Make component ${comp} has a BOM but none effective at the parent's window` })
      }
    }

    // Acyclic — seed the ancestor path with the parent and walk the published subtree of each edge (2a.2 technique).
    for (const cycle of await this.detectBomCyclesFromEdges(tenantId, version.parentPartNo, edges, at)) {
      findings.push({ kind: 'CYCLE', path: cycle.path, detail: `Cycle: ${cycle.path.join(' → ')}` })
    }
    return findings
  }

  /** Cycle detection over a BOM's edges (D-L2-6) — the parent seeds the ancestor path; a re-entry is a cycle. */
  private async detectBomCyclesFromEdges(tenantId: string, rootPartNo: string, rootEdges: BomComponent[], at: Date): Promise<BomCycle[]> {
    const cycles: BomCycle[] = []
    const walk = async (partNo: string, path: Set<string>): Promise<void> => {
      const v = await this.repo.findBomAsOf(tenantId, partNo, at)
      if (!v) return
      for (const e of await this.repo.bomComponentsFor(v.id)) {
        if (path.has(e.componentPartNo)) {
          cycles.push({ path: [...path, e.componentPartNo] })
          continue
        }
        await walk(e.componentPartNo, new Set([...path, e.componentPartNo]))
      }
    }
    for (const e of rootEdges) {
      if (e.componentPartNo === rootPartNo) {
        cycles.push({ path: [rootPartNo, rootPartNo] }) // self-consumption
        continue
      }
      await walk(e.componentPartNo, new Set([rootPartNo, e.componentPartNo]))
    }
    return cycles
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
