import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
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
  type Operator,
  type Part,
  type Resource,
  type ResourceDowntime,
  type ResourceGroup,
  type ResourceTypeConfig,
  type Routing,
  type RoutingOperation,
} from './schema'

/**
 * All Drizzle queries for the master-data module. Every method is tenant-scoped;
 * this repository's `db` is scoped to ONLY `master_data` tables (O2). Cross-module
 * (org) reads never happen here — the service validates org refs via `org.read`.
 */
@Injectable()
export class MasterDataRepository {
  constructor(@Inject(MASTERDATA_DB) private readonly db: MasterDataDatabase) {}

  // --- audit (append-only, Layer 0 §6) ---------------------------------------
  /** Append master-data audit rows (one per change event). Append-only — never updated/deleted. */
  async appendAudit(rows: NewMasterDataAudit[]): Promise<void> {
    if (rows.length > 0) await this.db.insert(masterDataAudit).values(rows)
  }

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

  /** The active primary routing for a part (masterdata.read 1.1 — scheduling consumer). */
  findPrimaryRoutingForPart(tenantId: string, partId: string): Promise<Routing | undefined> {
    return this.db.query.routing.findFirst({
      where: and(
        eq(routing.tenantId, tenantId),
        eq(routing.partId, partId),
        eq(routing.isPrimary, true),
        eq(routing.status, 'active'),
      ),
    })
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
