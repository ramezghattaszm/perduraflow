import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import { MASTERDATA_DB, type MasterDataDatabase } from './master-data.db'
import {
  certification,
  masterDataAudit,
  operator,
  operatorQualification,
  part,
  resource,
  resourceDowntime,
  resourceGroup,
  resourceGroupMember,
  resourceTypeConfig,
  routing,
  routingOperation,
  uomConversion,
  type Certification,
  type NewCertification,
  type NewMasterDataAudit,
  type NewOperator,
  type NewPart,
  type NewResource,
  type NewResourceDowntime,
  type NewResourceGroup,
  type NewRouting,
  type NewRoutingOperation,
  type NewUomConversion,
  type Operator,
  type Part,
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

  /** Upsert a factor row (unique on tenant + part version + alternate UoM); returns the persisted row. */
  async upsertUomConversion(row: NewUomConversion): Promise<UomConversion> {
    const [out] = await this.db
      .insert(uomConversion)
      .values(row)
      .onConflictDoUpdate({
        target: [uomConversion.tenantId, uomConversion.partId, uomConversion.alternateUom],
        set: { baseUom: row.baseUom, factor: row.factor },
      })
      .returning()
    return out!
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
