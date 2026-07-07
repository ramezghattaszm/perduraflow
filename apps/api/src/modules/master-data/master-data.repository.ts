import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm'
import { MASTERDATA_DB, type MasterDataDatabase } from './master-data.db'
import {
  bom,
  bomComponent,
  certification,
  masterDataAudit,
  operator,
  operatorQualification,
  part,
  partPlant,
  plantPartMapping,
  resource,
  resourceDowntime,
  resourceGroup,
  resourceGroupMember,
  resourceTypeConfig,
  routing,
  routingOperation,
  uomConversion,
  type Bom,
  type BomComponent,
  type Certification,
  type NewBom,
  type NewBomComponent,
  type NewCertification,
  type NewMasterDataAudit,
  type NewOperator,
  type NewPart,
  type NewResource,
  type NewResourceDowntime,
  type NewResourceGroup,
  type NewPartPlant,
  type NewPlantPartMapping,
  type NewRouting,
  type NewRoutingOperation,
  type NewUomConversion,
  type Operator,
  type Part,
  type PartPlant,
  type PlantPartMapping,
  type Resource,
  type ResourceDowntime,
  type ResourceGroup,
  type ResourceTypeConfig,
  type Routing,
  type RoutingOperation,
  type UomConversion,
} from './schema'

/**
 * All Drizzle queries for the master-data module. Every method is tenant-scoped;
 * this repository's `db` is scoped to ONLY `master_data` tables (O2). Cross-module
 * (org) reads never happen here — the service validates org refs via `org.read`.
 */
@Injectable()
export class MasterDataRepository {
  constructor(@Inject(MASTERDATA_DB) private readonly db: MasterDataDatabase) {}

  // --- part ------------------------------------------------------------------
  listParts(tenantId: string): Promise<Part[]> {
    return this.db.select().from(part).where(eq(part.tenantId, tenantId)).orderBy(asc(part.partNo))
  }

  findPart(tenantId: string, id: string): Promise<Part | undefined> {
    return this.db.query.part.findFirst({ where: and(eq(part.tenantId, tenantId), eq(part.id, id)) })
  }

  findPartByNo(tenantId: string, partNo: string): Promise<Part | undefined> {
    return this.db.query.part.findFirst({ where: and(eq(part.tenantId, tenantId), eq(part.partNo, partNo)) })
  }

  async partIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: part.id })
      .from(part)
      .where(and(eq(part.tenantId, tenantId), inArray(part.id, ids)))
    return rows.map((r) => r.id)
  }

  async createPart(data: NewPart): Promise<Part> {
    const [row] = await this.db.insert(part).values(data).returning()
    return row!
  }

  async updatePart(tenantId: string, id: string, patch: Partial<NewPart>): Promise<Part | undefined> {
    const [row] = await this.db
      .update(part)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(part.tenantId, tenantId), eq(part.id, id)))
      .returning()
    return row
  }

  // --- part: Layer 0 versioned reads + transactional revise ------------------
  /**
   * The part version effective at `asOf` for a business key — half-open `[effective_from,
   * effective_to)`: `effective_from <= asOf AND (effective_to IS NULL OR effective_to > asOf)`,
   * matching the GiST exclusion constraint's `tstzrange`. At most one row by construction.
   */
  findPartAsOf(tenantId: string, partNo: string, asOf: Date): Promise<Part | undefined> {
    return this.db.query.part.findFirst({
      where: and(
        eq(part.tenantId, tenantId),
        eq(part.partNo, partNo),
        lte(part.effectiveFrom, asOf),
        or(isNull(part.effectiveTo), gt(part.effectiveTo, asOf)),
      ),
    })
  }

  /** The current OPEN part version (`effective_to IS NULL`) for a business key, or undefined. */
  findOpenPart(tenantId: string, partNo: string): Promise<Part | undefined> {
    return this.db.query.part.findFirst({
      where: and(eq(part.tenantId, tenantId), eq(part.partNo, partNo), isNull(part.effectiveTo)),
    })
  }

  /** Full revision history for a `part_no`, oldest first. */
  listPartVersions(tenantId: string, partNo: string): Promise<Part[]> {
    return this.db
      .select()
      .from(part)
      .where(and(eq(part.tenantId, tenantId), eq(part.partNo, partNo)))
      .orderBy(asc(part.effectiveFrom))
  }

  /**
   * Transactionally supersede a part: close the prior open version's window at `effectiveFrom`,
   * insert the new open version, append audit rows — all atomic (any failure rolls back all three).
   * The prior close is guarded on `effective_to IS NULL` (concurrency-safe).
   */
  async revisePartTx(input: {
    tenantId: string
    priorId: string
    effectiveFrom: Date
    newVersion: NewPart
    auditRows: NewMasterDataAudit[]
    /** UoM factor rows to bind to the new version (guarded copy-forward — empty when the base UoM changed). */
    uomFactors?: NewUomConversion[]
  }): Promise<Part> {
    return this.db.transaction(async (tx) => {
      const closed = await tx
        .update(part)
        .set({ effectiveTo: input.effectiveFrom, updatedAt: new Date() })
        .where(and(eq(part.tenantId, input.tenantId), eq(part.id, input.priorId), isNull(part.effectiveTo)))
        .returning()
      if (closed.length === 0) throw new Error('revisePartTx: prior version is not open')
      const [newRow] = await tx.insert(part).values(input.newVersion).returning()
      if (input.auditRows.length > 0) await tx.insert(masterDataAudit).values(input.auditRows)
      if (input.uomFactors && input.uomFactors.length > 0) await tx.insert(uomConversion).values(input.uomFactors)
      return newRow!
    })
  }

  // --- uom conversion --------------------------------------------------------
  /** Factor rows bound to a specific part **version** (`part_id`), sorted by alternate UoM. */
  listUomConversions(tenantId: string, partId: string): Promise<UomConversion[]> {
    return this.db
      .select()
      .from(uomConversion)
      .where(and(eq(uomConversion.tenantId, tenantId), eq(uomConversion.partId, partId)))
      .orderBy(asc(uomConversion.alternateUom))
  }

  /** The factor row for a `(part version, alternate UoM)`, or undefined (used to label create vs update). */
  findUomConversion(tenantId: string, partId: string, alternateUom: string): Promise<UomConversion | undefined> {
    return this.db.query.uomConversion.findFirst({
      where: and(
        eq(uomConversion.tenantId, tenantId),
        eq(uomConversion.partId, partId),
        eq(uomConversion.alternateUom, alternateUom),
      ),
    })
  }

  /**
   * Upsert a factor row (unique on tenant + part version + alternate UoM) and append its audit row —
   * atomic (both commit or roll back together). Returns the persisted row.
   */
  async upsertUomConversionWithAudit(row: NewUomConversion, auditRow: NewMasterDataAudit): Promise<UomConversion> {
    return this.db.transaction(async (tx) => {
      const [out] = await tx
        .insert(uomConversion)
        .values(row)
        .onConflictDoUpdate({
          target: [uomConversion.tenantId, uomConversion.partId, uomConversion.alternateUom],
          set: { baseUom: row.baseUom, factor: row.factor },
        })
        .returning()
      await tx.insert(masterDataAudit).values(auditRow)
      return out!
    })
  }

  // --- part_plant (per-plant override layer, §4E) ----------------------------
  /**
   * The per-plant override effective at `asOf` for `(part_no, plant_id)` — half-open `[effective_from,
   * effective_to)`, same window predicate as the part read. At most one row by construction (partial
   * unique on open + GiST non-overlap). Undefined when the plant has no override window covering `asOf`.
   */
  findPartPlantAsOf(tenantId: string, partNo: string, plantId: string, asOf: Date): Promise<PartPlant | undefined> {
    return this.db.query.partPlant.findFirst({
      where: and(
        eq(partPlant.tenantId, tenantId),
        eq(partPlant.partNo, partNo),
        eq(partPlant.plantId, plantId),
        lte(partPlant.effectiveFrom, asOf),
        or(isNull(partPlant.effectiveTo), gt(partPlant.effectiveTo, asOf)),
      ),
    })
  }

  /** The current OPEN override (`effective_to IS NULL`) for `(part_no, plant_id)`, or undefined. */
  findOpenPartPlant(tenantId: string, partNo: string, plantId: string): Promise<PartPlant | undefined> {
    return this.db.query.partPlant.findFirst({
      where: and(
        eq(partPlant.tenantId, tenantId),
        eq(partPlant.partNo, partNo),
        eq(partPlant.plantId, plantId),
        isNull(partPlant.effectiveTo),
      ),
    })
  }

  /**
   * Transactionally set a per-plant override window: when `priorId` is given, close that open window at
   * `effectiveFrom` (guarded on `effective_to IS NULL`, concurrency-safe) — a revise; otherwise a fresh
   * create. Always inserts the new open row and appends audit rows — all atomic.
   */
  async revisePartPlantTx(input: {
    tenantId: string
    priorId?: string
    effectiveFrom: Date
    newRow: NewPartPlant
    auditRows: NewMasterDataAudit[]
  }): Promise<PartPlant> {
    return this.db.transaction(async (tx) => {
      if (input.priorId) {
        const closed = await tx
          .update(partPlant)
          .set({ effectiveTo: input.effectiveFrom, updatedAt: new Date() })
          .where(and(eq(partPlant.tenantId, input.tenantId), eq(partPlant.id, input.priorId), isNull(partPlant.effectiveTo)))
          .returning()
        if (closed.length === 0) throw new Error('revisePartPlantTx: prior override is not open')
      }
      const [newRow] = await tx.insert(partPlant).values(input.newRow).returning()
      if (input.auditRows.length > 0) await tx.insert(masterDataAudit).values(input.auditRows)
      return newRow!
    })
  }

  // --- plant_part_mapping (plant-local alias → global part, §4D / MD9) --------
  /**
   * The mapping effective at `asOf` for `(plant_id, plant_part_no)` — half-open `[effective_from,
   * effective_to)`. At most one row by construction (partial unique on open + GiST non-overlap).
   * Undefined when no mapping window covers `asOf`.
   */
  findPlantPartMappingAsOf(tenantId: string, plantId: string, plantPartNo: string, asOf: Date): Promise<PlantPartMapping | undefined> {
    return this.db.query.plantPartMapping.findFirst({
      where: and(
        eq(plantPartMapping.tenantId, tenantId),
        eq(plantPartMapping.plantId, plantId),
        eq(plantPartMapping.plantPartNo, plantPartNo),
        lte(plantPartMapping.effectiveFrom, asOf),
        or(isNull(plantPartMapping.effectiveTo), gt(plantPartMapping.effectiveTo, asOf)),
      ),
    })
  }

  /** The current OPEN mapping (`effective_to IS NULL`) for `(plant_id, plant_part_no)`, or undefined. */
  findOpenPlantPartMapping(tenantId: string, plantId: string, plantPartNo: string): Promise<PlantPartMapping | undefined> {
    return this.db.query.plantPartMapping.findFirst({
      where: and(
        eq(plantPartMapping.tenantId, tenantId),
        eq(plantPartMapping.plantId, plantId),
        eq(plantPartMapping.plantPartNo, plantPartNo),
        isNull(plantPartMapping.effectiveTo),
      ),
    })
  }

  /**
   * The part **version** effective at `asOf` bearing the inline customer ref `(customer_id,
   * customer_part_no)` (MD9 customer resolution), or undefined. The customer fields ride the part
   * revision, so this is a windowed read of the part table.
   */
  findPartByCustomerRefAsOf(tenantId: string, customerId: string, customerPartNo: string, asOf: Date): Promise<Part | undefined> {
    return this.db.query.part.findFirst({
      where: and(
        eq(part.tenantId, tenantId),
        eq(part.customerId, customerId),
        eq(part.customerPartNo, customerPartNo),
        lte(part.effectiveFrom, asOf),
        or(isNull(part.effectiveTo), gt(part.effectiveTo, asOf)),
      ),
    })
  }

  /**
   * Transactionally set a plant-local mapping window: when `priorId` is given, close that open window at
   * `effectiveFrom` (guarded on `effective_to IS NULL`) — a revise; otherwise a fresh create. Always
   * inserts the new open row and appends audit rows — all atomic.
   */
  async revisePlantPartMappingTx(input: {
    tenantId: string
    priorId?: string
    effectiveFrom: Date
    newRow: NewPlantPartMapping
    auditRows: NewMasterDataAudit[]
  }): Promise<PlantPartMapping> {
    return this.db.transaction(async (tx) => {
      if (input.priorId) {
        const closed = await tx
          .update(plantPartMapping)
          .set({ effectiveTo: input.effectiveFrom, updatedAt: new Date() })
          .where(and(eq(plantPartMapping.tenantId, input.tenantId), eq(plantPartMapping.id, input.priorId), isNull(plantPartMapping.effectiveTo)))
          .returning()
        if (closed.length === 0) throw new Error('revisePlantPartMappingTx: prior mapping is not open')
      }
      const [newRow] = await tx.insert(plantPartMapping).values(input.newRow).returning()
      if (input.auditRows.length > 0) await tx.insert(masterDataAudit).values(input.auditRows)
      return newRow!
    })
  }

  // --- resource --------------------------------------------------------------
  listResources(tenantId: string): Promise<Resource[]> {
    return this.db.select().from(resource).where(eq(resource.tenantId, tenantId)).orderBy(asc(resource.name))
  }

  /** Resource-type shift config rows (D-shift) — splittable / OT cap per resource type. */
  listResourceTypeConfigs(tenantId: string): Promise<ResourceTypeConfig[]> {
    return this.db.select().from(resourceTypeConfig).where(eq(resourceTypeConfig.tenantId, tenantId))
  }

  findResource(tenantId: string, id: string): Promise<Resource | undefined> {
    return this.db.query.resource.findFirst({ where: and(eq(resource.tenantId, tenantId), eq(resource.id, id)) })
  }

  async resourceIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: resource.id })
      .from(resource)
      .where(and(eq(resource.tenantId, tenantId), inArray(resource.id, ids)))
    return rows.map((r) => r.id)
  }

  async createResource(data: NewResource): Promise<Resource> {
    const [row] = await this.db.insert(resource).values(data).returning()
    return row!
  }

  async updateResource(tenantId: string, id: string, patch: Partial<NewResource>): Promise<Resource | undefined> {
    const [row] = await this.db
      .update(resource)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(resource.tenantId, tenantId), eq(resource.id, id)))
      .returning()
    return row
  }

  /** Create a resource + its audit row atomically (Pattern B — §6). */
  async createResourceWithAudit(
    data: NewResource,
    makeAudit: (row: Resource) => NewMasterDataAudit,
  ): Promise<Resource> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(resource).values(data).returning()
      await tx.insert(masterDataAudit).values(makeAudit(row!))
      return row!
    })
  }

  /**
   * Update a resource + write its audit row atomically (Pattern B — §6). Reads the prior row and
   * builds the audit inside the transaction; `buildAudit` returning null (no tracked field changed)
   * skips the audit write. Any failure — including a throw from `buildAudit` — rolls back the update.
   */
  async updateResourceWithAudit(
    tenantId: string,
    id: string,
    patch: Partial<NewResource>,
    buildAudit: (before: Resource, after: Resource) => NewMasterDataAudit | null,
  ): Promise<Resource | undefined> {
    return this.db.transaction(async (tx) => {
      const before = await tx.query.resource.findFirst({
        where: and(eq(resource.tenantId, tenantId), eq(resource.id, id)),
      })
      if (!before) return undefined
      const [after] = await tx
        .update(resource)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(resource.tenantId, tenantId), eq(resource.id, id)))
        .returning()
      const audit = buildAudit(before, after!)
      if (audit) await tx.insert(masterDataAudit).values(audit)
      return after
    })
  }

  // --- resource downtime (line-down / maintenance closures) ------------------
  async createDowntime(data: NewResourceDowntime): Promise<ResourceDowntime> {
    const [row] = await this.db.insert(resourceDowntime).values(data).returning()
    return row!
  }

  findDowntime(tenantId: string, id: string): Promise<ResourceDowntime | undefined> {
    return this.db.query.resourceDowntime.findFirst({
      where: and(eq(resourceDowntime.tenantId, tenantId), eq(resourceDowntime.id, id)),
    })
  }

  /**
   * Active downtime windows: `is_active` (not retracted) and not yet fully past
   * (`to_ts > now`), optionally plant-scoped. Covers currently-in-effect + future
   * closures — the set the sequencer subtracts and the board reads for DOWN.
   */
  listActiveDowntime(tenantId: string, now: Date, plantId?: string): Promise<ResourceDowntime[]> {
    return this.db
      .select()
      .from(resourceDowntime)
      .where(
        and(
          eq(resourceDowntime.tenantId, tenantId),
          eq(resourceDowntime.isActive, true),
          gt(resourceDowntime.toTs, now),
          ...(plantId ? [eq(resourceDowntime.plantId, plantId)] : []),
        ),
      )
      .orderBy(desc(resourceDowntime.fromTs))
  }

  async updateDowntime(
    tenantId: string,
    id: string,
    patch: Partial<NewResourceDowntime>,
  ): Promise<ResourceDowntime | undefined> {
    const [row] = await this.db
      .update(resourceDowntime)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(resourceDowntime.tenantId, tenantId), eq(resourceDowntime.id, id)))
      .returning()
    return row
  }

  // --- resource group --------------------------------------------------------
  listResourceGroups(tenantId: string): Promise<ResourceGroup[]> {
    return this.db
      .select()
      .from(resourceGroup)
      .where(eq(resourceGroup.tenantId, tenantId))
      .orderBy(asc(resourceGroup.name))
  }

  findResourceGroup(tenantId: string, id: string): Promise<ResourceGroup | undefined> {
    return this.db.query.resourceGroup.findFirst({
      where: and(eq(resourceGroup.tenantId, tenantId), eq(resourceGroup.id, id)),
    })
  }

  async resourceGroupIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: resourceGroup.id })
      .from(resourceGroup)
      .where(and(eq(resourceGroup.tenantId, tenantId), inArray(resourceGroup.id, ids)))
    return rows.map((r) => r.id)
  }

  async memberResourceIds(groupId: string): Promise<string[]> {
    const rows = await this.db
      .select({ resourceId: resourceGroupMember.resourceId })
      .from(resourceGroupMember)
      .where(eq(resourceGroupMember.resourceGroupId, groupId))
    return rows.map((r) => r.resourceId)
  }

  async createResourceGroup(data: NewResourceGroup, memberResourceIds: string[]): Promise<ResourceGroup> {
    const [row] = await this.db.insert(resourceGroup).values(data).returning()
    await this.replaceGroupMembers(row!.tenantId, row!.id, memberResourceIds)
    return row!
  }

  async updateResourceGroup(
    tenantId: string,
    id: string,
    patch: Partial<NewResourceGroup>,
    memberResourceIds?: string[],
  ): Promise<ResourceGroup | undefined> {
    const [row] = await this.db
      .update(resourceGroup)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(resourceGroup.tenantId, tenantId), eq(resourceGroup.id, id)))
      .returning()
    if (row && memberResourceIds) await this.replaceGroupMembers(tenantId, id, memberResourceIds)
    return row
  }

  /** Create a resource group (+ members) + its audit row atomically (Pattern B — §6). */
  async createResourceGroupWithAudit(
    data: NewResourceGroup,
    memberResourceIds: string[],
    makeAudit: (row: ResourceGroup) => NewMasterDataAudit,
  ): Promise<ResourceGroup> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(resourceGroup).values(data).returning()
      if (memberResourceIds.length > 0) {
        await tx
          .insert(resourceGroupMember)
          .values(memberResourceIds.map((resourceId) => ({ tenantId: row!.tenantId, resourceGroupId: row!.id, resourceId })))
      }
      await tx.insert(masterDataAudit).values(makeAudit(row!))
      return row!
    })
  }

  /**
   * Update a resource group (header + optional member replace) + its audit row atomically (Pattern B).
   * Reads prior header + members inside the tx; `buildAudit` returning null skips the audit write. Any
   * failure rolls back the whole change. Returns the updated row + resolved member ids, or undefined.
   */
  async updateResourceGroupWithAudit(
    tenantId: string,
    id: string,
    patch: Partial<NewResourceGroup>,
    memberResourceIds: string[] | undefined,
    buildAudit: (
      before: ResourceGroup,
      after: ResourceGroup,
      oldMembers: string[],
      newMembers: string[],
    ) => NewMasterDataAudit | null,
  ): Promise<{ row: ResourceGroup; members: string[] } | undefined> {
    return this.db.transaction(async (tx) => {
      const before = await tx.query.resourceGroup.findFirst({
        where: and(eq(resourceGroup.tenantId, tenantId), eq(resourceGroup.id, id)),
      })
      if (!before) return undefined
      const oldMembers = (
        await tx
          .select({ resourceId: resourceGroupMember.resourceId })
          .from(resourceGroupMember)
          .where(eq(resourceGroupMember.resourceGroupId, id))
      ).map((r) => r.resourceId)
      const [after] = await tx
        .update(resourceGroup)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(resourceGroup.tenantId, tenantId), eq(resourceGroup.id, id)))
        .returning()
      let newMembers = oldMembers
      if (memberResourceIds) {
        await tx.delete(resourceGroupMember).where(eq(resourceGroupMember.resourceGroupId, id))
        if (memberResourceIds.length > 0) {
          await tx
            .insert(resourceGroupMember)
            .values(memberResourceIds.map((resourceId) => ({ tenantId, resourceGroupId: id, resourceId })))
        }
        newMembers = memberResourceIds
      }
      const audit = buildAudit(before, after!, oldMembers, newMembers)
      if (audit) await tx.insert(masterDataAudit).values(audit)
      return { row: after!, members: newMembers }
    })
  }

  private async replaceGroupMembers(tenantId: string, groupId: string, resourceIds: string[]): Promise<void> {
    await this.db.delete(resourceGroupMember).where(eq(resourceGroupMember.resourceGroupId, groupId))
    if (resourceIds.length === 0) return
    await this.db
      .insert(resourceGroupMember)
      .values(resourceIds.map((resourceId) => ({ tenantId, resourceGroupId: groupId, resourceId })))
  }

  // --- routing + operations --------------------------------------------------
  listRoutings(tenantId: string): Promise<Routing[]> {
    return this.db.select().from(routing).where(eq(routing.tenantId, tenantId)).orderBy(asc(routing.name))
  }

  findRouting(tenantId: string, id: string): Promise<Routing | undefined> {
    return this.db.query.routing.findFirst({ where: and(eq(routing.tenantId, tenantId), eq(routing.id, id)) })
  }

  /**
   * @deprecated The active primary routing for a part by version `id` (masterdata.read 1.1). Layer 0
   * shim: resolves the part's business key then the OPEN primary routing (`part_id` was dropped in
   * Commit 6). Consumers use `resolveRouting(part_no, { primaryOnly, asOf })`.
   */
  async findPrimaryRoutingForPart(tenantId: string, partId: string): Promise<Routing | undefined> {
    const p = await this.findPart(tenantId, partId)
    if (!p) return undefined
    return this.findOpenRouting(tenantId, p.partNo, { primaryOnly: true })
  }

  operationsFor(routingId: string): Promise<RoutingOperation[]> {
    return this.db
      .select()
      .from(routingOperation)
      .where(eq(routingOperation.routingId, routingId))
      .orderBy(asc(routingOperation.opSeq))
  }

  async createRouting(data: NewRouting, operations: Omit<NewRoutingOperation, 'routingId' | 'tenantId'>[]): Promise<Routing> {
    const [row] = await this.db.insert(routing).values(data).returning()
    await this.replaceOperations(row!.tenantId, row!.id, operations)
    return row!
  }

  async updateRouting(
    tenantId: string,
    id: string,
    patch: Partial<NewRouting>,
    operations?: Omit<NewRoutingOperation, 'routingId' | 'tenantId'>[],
  ): Promise<Routing | undefined> {
    const [row] = await this.db
      .update(routing)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(routing.tenantId, tenantId), eq(routing.id, id)))
      .returning()
    if (row && operations) await this.replaceOperations(tenantId, id, operations)
    return row
  }

  // --- routing: Layer 0 versioned reads + transactional revise ---------------
  private routingKey(tenantId: string, partNo: string, opts: { name?: string; primaryOnly?: boolean }) {
    return and(
      eq(routing.tenantId, tenantId),
      eq(routing.partNo, partNo),
      ...(opts.name ? [eq(routing.name, opts.name)] : []),
      ...(opts.primaryOnly ? [eq(routing.isPrimary, true)] : []),
    )
  }

  /**
   * The routing version effective at `asOf` for a `part_no` (optionally by `name` / primary-only) —
   * half-open `[effective_from, effective_to)`, matching the exclusion constraint's `tstzrange`.
   */
  findRoutingAsOf(
    tenantId: string,
    partNo: string,
    opts: { name?: string; primaryOnly?: boolean; asOf: Date },
  ): Promise<Routing | undefined> {
    return this.db.query.routing.findFirst({
      where: and(
        this.routingKey(tenantId, partNo, opts),
        lte(routing.effectiveFrom, opts.asOf),
        or(isNull(routing.effectiveTo), gt(routing.effectiveTo, opts.asOf)),
      ),
    })
  }

  /** The current OPEN routing version for a `part_no` (optionally by `name` / primary), or undefined. */
  findOpenRouting(
    tenantId: string,
    partNo: string,
    opts: { name?: string; primaryOnly?: boolean } = {},
  ): Promise<Routing | undefined> {
    return this.db.query.routing.findFirst({
      where: and(this.routingKey(tenantId, partNo, opts), isNull(routing.effectiveTo)),
    })
  }

  /**
   * Transactionally supersede a routing: close the prior open version, insert the new open version with
   * its operation rows copied on (routingId rebound to the new version), append audit — all atomic.
   */
  async reviseRoutingTx(input: {
    tenantId: string
    priorId: string
    effectiveFrom: Date
    newVersion: NewRouting
    operations: Omit<NewRoutingOperation, 'routingId'>[]
    auditRows: NewMasterDataAudit[]
  }): Promise<Routing> {
    return this.db.transaction(async (tx) => {
      const closed = await tx
        .update(routing)
        .set({ effectiveTo: input.effectiveFrom, updatedAt: new Date() })
        .where(and(eq(routing.tenantId, input.tenantId), eq(routing.id, input.priorId), isNull(routing.effectiveTo)))
        .returning()
      if (closed.length === 0) throw new Error('reviseRoutingTx: prior version is not open')
      const [newRow] = await tx.insert(routing).values(input.newVersion).returning()
      if (input.operations.length > 0) {
        await tx.insert(routingOperation).values(input.operations.map((op) => ({ ...op, routingId: newRow!.id })))
      }
      if (input.auditRows.length > 0) await tx.insert(masterDataAudit).values(input.auditRows)
      return newRow!
    })
  }

  // --- bom (Layer 2 §4a — version header + edge children) --------------------
  /** The current open DRAFT BOM for a `parent_part_no`, or undefined (at most one). */
  findOpenDraftBom(tenantId: string, parentPartNo: string): Promise<Bom | undefined> {
    return this.db.query.bom.findFirst({
      where: and(eq(bom.tenantId, tenantId), eq(bom.parentPartNo, parentPartNo), eq(bom.status, 'draft')),
    })
  }

  /** The current OPEN published BOM (`status='published' AND effective_to IS NULL`) for a parent, or undefined. */
  findOpenPublishedBom(tenantId: string, parentPartNo: string): Promise<Bom | undefined> {
    return this.db.query.bom.findFirst({
      where: and(eq(bom.tenantId, tenantId), eq(bom.parentPartNo, parentPartNo), eq(bom.status, 'published'), isNull(bom.effectiveTo)),
    })
  }

  /**
   * The BOM version effective at `asOf` for a parent — half-open `[effective_from, effective_to)` over the
   * NON-DRAFT versions (published + superseded), so a historical `asOf` reconstructs the version that WAS
   * live then even after it was superseded (mirrors Layer-0 part/routing resolve-as-of). Drafts carry no
   * window (`effective_from` null) so they never match. At most one row by construction (GiST non-overlap).
   */
  findBomAsOf(tenantId: string, parentPartNo: string, asOf: Date): Promise<Bom | undefined> {
    return this.db.query.bom.findFirst({
      where: and(
        eq(bom.tenantId, tenantId),
        eq(bom.parentPartNo, parentPartNo),
        ne(bom.status, 'draft'),
        lte(bom.effectiveFrom, asOf),
        or(isNull(bom.effectiveTo), gt(bom.effectiveTo, asOf)),
      ),
    })
  }

  /** The edge rows (direct components) of a BOM version, sorted by component. */
  bomComponentsFor(bomId: string): Promise<BomComponent[]> {
    return this.db
      .select()
      .from(bomComponent)
      .where(eq(bomComponent.bomId, bomId))
      .orderBy(asc(bomComponent.componentPartNo))
  }

  /**
   * Author/update the DRAFT BOM for a parent, transactionally: upsert the draft header (insert a new draft,
   * or update the existing one's revision), REPLACE its edge rows, append audit — all atomic. Drafts carry
   * no window (mirrors {@link reviseRoutingTx}'s child-copy, minus the effectivity close).
   */
  async reviseBomTx(input: {
    tenantId: string
    draftId?: string
    header: NewBom
    components: Omit<NewBomComponent, 'bomId'>[]
    auditRows: NewMasterDataAudit[]
  }): Promise<Bom> {
    return this.db.transaction(async (tx) => {
      let draft: Bom
      if (input.draftId) {
        const [updated] = await tx
          .update(bom)
          .set({ revision: input.header.revision, updatedAt: new Date() })
          .where(and(eq(bom.tenantId, input.tenantId), eq(bom.id, input.draftId), eq(bom.status, 'draft')))
          .returning()
        if (!updated) throw new Error('reviseBomTx: draft not found or not a draft')
        draft = updated
        await tx.delete(bomComponent).where(eq(bomComponent.bomId, draft.id))
      } else {
        const [inserted] = await tx.insert(bom).values(input.header).returning()
        draft = inserted!
      }
      if (input.components.length > 0) {
        await tx.insert(bomComponent).values(input.components.map((c) => ({ ...c, bomId: draft.id })))
      }
      if (input.auditRows.length > 0) await tx.insert(masterDataAudit).values(input.auditRows)
      return draft
    })
  }

  /**
   * Publish a draft transactionally: close the prior open published version at `effectiveFrom` (status →
   * `superseded`, guarded on `published AND effective_to IS NULL`) when one exists, flip the draft →
   * `published` with an open window + `supersedes_id`, append audit — all atomic.
   */
  async publishBomTx(input: {
    tenantId: string
    draftId: string
    priorPublishedId?: string
    effectiveFrom: Date
    auditRows: NewMasterDataAudit[]
  }): Promise<Bom> {
    return this.db.transaction(async (tx) => {
      if (input.priorPublishedId) {
        const closed = await tx
          .update(bom)
          .set({ status: 'superseded', effectiveTo: input.effectiveFrom, updatedAt: new Date() })
          .where(and(eq(bom.tenantId, input.tenantId), eq(bom.id, input.priorPublishedId), eq(bom.status, 'published'), isNull(bom.effectiveTo)))
          .returning()
        if (closed.length === 0) throw new Error('publishBomTx: prior published version is not open')
      }
      const [published] = await tx
        .update(bom)
        .set({ status: 'published', effectiveFrom: input.effectiveFrom, effectiveTo: null, supersedesId: input.priorPublishedId ?? null, updatedAt: new Date() })
        .where(and(eq(bom.tenantId, input.tenantId), eq(bom.id, input.draftId), eq(bom.status, 'draft')))
        .returning()
      if (!published) throw new Error('publishBomTx: draft not found or not a draft')
      if (input.auditRows.length > 0) await tx.insert(masterDataAudit).values(input.auditRows)
      return published
    })
  }

  private async replaceOperations(
    tenantId: string,
    routingId: string,
    operations: Omit<NewRoutingOperation, 'routingId' | 'tenantId'>[],
  ): Promise<void> {
    await this.db.delete(routingOperation).where(eq(routingOperation.routingId, routingId))
    if (operations.length === 0) return
    await this.db.insert(routingOperation).values(operations.map((op) => ({ ...op, tenantId, routingId })))
  }

  // --- certification ---------------------------------------------------------
  listCertifications(tenantId: string): Promise<Certification[]> {
    return this.db
      .select()
      .from(certification)
      .where(eq(certification.tenantId, tenantId))
      .orderBy(asc(certification.code))
  }

  findCertification(tenantId: string, id: string): Promise<Certification | undefined> {
    return this.db.query.certification.findFirst({
      where: and(eq(certification.tenantId, tenantId), eq(certification.id, id)),
    })
  }

  findCertificationByCode(tenantId: string, code: string): Promise<Certification | undefined> {
    return this.db.query.certification.findFirst({
      where: and(eq(certification.tenantId, tenantId), eq(certification.code, code)),
    })
  }

  async createCertification(data: NewCertification): Promise<Certification> {
    const [row] = await this.db.insert(certification).values(data).returning()
    return row!
  }

  async updateCertification(
    tenantId: string,
    id: string,
    patch: Partial<NewCertification>,
  ): Promise<Certification | undefined> {
    const [row] = await this.db
      .update(certification)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(certification.tenantId, tenantId), eq(certification.id, id)))
      .returning()
    return row
  }

  // --- operator + qualifications ---------------------------------------------
  listOperators(tenantId: string): Promise<Operator[]> {
    return this.db.select().from(operator).where(eq(operator.tenantId, tenantId)).orderBy(asc(operator.name))
  }

  findOperator(tenantId: string, id: string): Promise<Operator | undefined> {
    return this.db.query.operator.findFirst({ where: and(eq(operator.tenantId, tenantId), eq(operator.id, id)) })
  }

  async createOperator(data: NewOperator): Promise<Operator> {
    const [row] = await this.db.insert(operator).values(data).returning()
    return row!
  }

  async updateOperator(tenantId: string, id: string, patch: Partial<NewOperator>): Promise<Operator | undefined> {
    const [row] = await this.db
      .update(operator)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(operator.tenantId, tenantId), eq(operator.id, id)))
      .returning()
    return row
  }

  async certificationIdsForOperator(operatorId: string): Promise<string[]> {
    const rows = await this.db
      .select({ certificationId: operatorQualification.certificationId })
      .from(operatorQualification)
      .where(eq(operatorQualification.operatorId, operatorId))
    return rows.map((r) => r.certificationId)
  }

  /** Adds or removes one operator×certification qualification (idempotent). */
  async setQualification(
    tenantId: string,
    operatorId: string,
    certificationId: string,
    qualified: boolean,
  ): Promise<void> {
    if (qualified) {
      await this.db
        .insert(operatorQualification)
        .values({ tenantId, operatorId, certificationId })
        .onConflictDoNothing()
      return
    }
    await this.db
      .delete(operatorQualification)
      .where(
        and(
          eq(operatorQualification.operatorId, operatorId),
          eq(operatorQualification.certificationId, certificationId),
        ),
      )
  }
}
