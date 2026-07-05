import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import {
  type CertificationDto,
  type CreateCertificationRequest,
  type CreateOperatorRequest,
  type CreatePartRequest,
  type CreateResourceDowntimeRequest,
  type CreateResourceGroupRequest,
  type CreateResourceRequest,
  type CreateRoutingRequest,
  type OperatorDto,
  type OrgReadContract,
  type PartDto,
  type ResourceDowntimeDto,
  type ResourceDto,
  type ResourceGroupDto,
  type RoutingDto,
  type SetOperatorQualificationRequest,
  type UpdateCertificationRequest,
  type UpdateOperatorRequest,
  type UpdatePartRequest,
  type UpdateResourceGroupRequest,
  type UpdateResourceRequest,
  type UpdateRoutingRequest,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { EVENTS } from '../../events'
import { EventBus } from '../eventbus/event-bus'
import { ORG_READ } from '../org/org-read.service'
import {
  toCertificationDto,
  toOperatorDto,
  toPartDto,
  toResourceDowntimeDto,
  toResourceDto,
  toResourceGroupDto,
  toRoutingDto,
} from './master-data.mapper'
import { MasterDataRepository } from './master-data.repository'
import {
  type MasterDataAuditAction,
  type MasterDataAuditChange,
  type MasterDataEntityType,
} from './schema'

/** Actor sentinel for changes with no JWT user (seed / system paths) — never null (§6). */
const SYSTEM_ACTOR = 'system'

/** Columns audited on a `resource` change (excludes id/tenant/timestamps). */
const RESOURCE_AUDIT_COLS = [
  'name',
  'resourceType',
  'plantId',
  'calendarId',
  'rate',
  'rateUom',
  'runCostPerHour',
  'setupCost',
  'overheadPerUnit',
  'otCapMinutes',
  'status',
] as const

/** Columns audited on a `resource_group` header change (members handled separately). */
const RESOURCE_GROUP_AUDIT_COLS = ['name', 'plantId', 'isActive'] as const

/**
 * Master Data domain service — admin CRUD for parts, resources, resource groups,
 * routings (+ operations), certifications, and operators (+ qualifications).
 * Every operation is tenant-scoped from the JWT. **Cross-module references to the
 * kernel org model (`plant_id`, `calendar_id`, `home_plant_id`) are validated
 * through the injected `org.read` contract (O4)** — never by reaching into org's
 * tables. Intra-module references (part, resource group) are validated locally.
 * Creates publish through the EventBus (O5).
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly repo: MasterDataRepository,
    @Inject(ORG_READ) private readonly org: OrgReadContract,
    private readonly events: EventBus,
  ) {}

  // --- part ------------------------------------------------------------------
  /** Lists the tenant's parts. */
  async listParts(tenantId: string): Promise<PartDto[]> {
    return (await this.repo.listParts(tenantId)).map(toPartDto)
  }

  /**
   * Creates a part. Emits `master_data.part.created`.
   * @throws AppException DUPLICATE_PART_NO - `part_no` already used in the tenant
   */
  async createPart(tenantId: string, dto: CreatePartRequest): Promise<PartDto> {
    if (await this.repo.findPartByNo(tenantId, dto.partNo)) {
      throw new AppException(HttpStatus.CONFLICT, 'Part number already exists', ERROR_CODES.DUPLICATE_PART_NO)
    }
    const row = await this.repo.createPart({ ...dto, tenantId })
    await this.events.publish(EVENTS.PART_CREATED, { id: row.id, tenantId, name: row.partNo }, tenantId)
    return toPartDto(row)
  }

  /**
   * Updates a part in the tenant.
   * @throws AppException PART_NOT_FOUND - no such part in the tenant
   * @throws AppException DUPLICATE_PART_NO - the new `part_no` collides
   */
  async updatePart(tenantId: string, id: string, dto: UpdatePartRequest): Promise<PartDto> {
    if (dto.partNo) {
      const existing = await this.repo.findPartByNo(tenantId, dto.partNo)
      if (existing && existing.id !== id) {
        throw new AppException(HttpStatus.CONFLICT, 'Part number already exists', ERROR_CODES.DUPLICATE_PART_NO)
      }
    }
    const row = await this.repo.updatePart(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Part not found', ERROR_CODES.PART_NOT_FOUND)
    return toPartDto(row)
  }

  // --- resource --------------------------------------------------------------
  /** Lists the tenant's resources. */
  async listResources(tenantId: string): Promise<ResourceDto[]> {
    return (await this.repo.listResources(tenantId)).map(toResourceDto)
  }

  /**
   * Creates a resource, validating its plant + calendar through `org.read` (O4).
   * Writes a `create` audit row (Pattern B — §6).
   * @throws AppException INVALID_PLANT_REFERENCE - plant did not resolve
   * @throws AppException INVALID_CALENDAR_REFERENCE - calendar did not resolve
   */
  async createResource(tenantId: string, dto: CreateResourceRequest, actor: string = SYSTEM_ACTOR): Promise<ResourceDto> {
    await this.assertPlant(tenantId, dto.plantId)
    await this.assertCalendar(tenantId, dto.calendarId)
    const row = await this.repo.createResource({ ...dto, tenantId })
    await this.writeAudit({
      tenantId,
      entityType: 'resource',
      businessKey: row.id,
      versionId: row.id,
      action: 'create',
      actor,
      changedFields: this.snapshot(row, RESOURCE_AUDIT_COLS),
    })
    await this.events.publish(EVENTS.RESOURCE_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toResourceDto(row)
  }

  /**
   * Updates a resource (re-validating plant/calendar when supplied). Writes one
   * audit row iff a tracked field actually changed — `deactivate` when the update
   * flips `status → inactive`, else `update` (Pattern B — §6).
   * @throws AppException RESOURCE_NOT_FOUND - no such resource in the tenant
   * @throws AppException INVALID_PLANT_REFERENCE / INVALID_CALENDAR_REFERENCE
   */
  async updateResource(tenantId: string, id: string, dto: UpdateResourceRequest, actor: string = SYSTEM_ACTOR): Promise<ResourceDto> {
    if (dto.plantId) await this.assertPlant(tenantId, dto.plantId)
    if (dto.calendarId) await this.assertCalendar(tenantId, dto.calendarId)
    const before = await this.repo.findResource(tenantId, id)
    if (!before) throw new AppException(HttpStatus.NOT_FOUND, 'Resource not found', ERROR_CODES.RESOURCE_NOT_FOUND)
    const row = await this.repo.updateResource(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Resource not found', ERROR_CODES.RESOURCE_NOT_FOUND)
    const changedFields = this.diff(before, row, RESOURCE_AUDIT_COLS)
    if (Object.keys(changedFields).length > 0) {
      await this.writeAudit({
        tenantId,
        entityType: 'resource',
        businessKey: row.id,
        versionId: row.id,
        action: changedFields['status']?.new === 'inactive' ? 'deactivate' : 'update',
        actor,
        changedFields,
      })
    }
    return toResourceDto(row)
  }

  // --- resource downtime (line-down / maintenance closures) ------------------
  /** Active downtime windows (line-down / maintenance), optionally plant-scoped. */
  async listActiveDowntime(tenantId: string, plantId?: string): Promise<ResourceDowntimeDto[]> {
    return (await this.repo.listActiveDowntime(tenantId, new Date(), plantId)).map(toResourceDowntimeDto)
  }

  /**
   * Opens a per-resource downtime window (line-down / maintenance). `plantId` is
   * derived from the resource; the window is a time-boxed closure the sequencer
   * subtracts from capacity (ops displace around it). Emits `…resource_downtime.opened`.
   * @throws AppException RESOURCE_NOT_FOUND - no such resource in the tenant
   * @throws AppException INVALID_DOWNTIME_WINDOW - `to <= from` (zero/negative duration)
   */
  async createDowntime(tenantId: string, dto: CreateResourceDowntimeRequest, createdBy: string): Promise<ResourceDowntimeDto> {
    const resourceRow = await this.repo.findResource(tenantId, dto.resourceId)
    if (!resourceRow) throw new AppException(HttpStatus.NOT_FOUND, 'Resource not found', ERROR_CODES.RESOURCE_NOT_FOUND)
    const from = new Date(dto.from)
    const to = new Date(dto.to)
    if (!(to.getTime() > from.getTime())) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'Downtime end must be after start', ERROR_CODES.INVALID_DOWNTIME_WINDOW)
    }
    const row = await this.repo.createDowntime({
      tenantId,
      resourceId: dto.resourceId,
      plantId: resourceRow.plantId,
      kind: dto.kind,
      planned: dto.planned,
      fromTs: from,
      toTs: to,
      reason: dto.reason,
      createdBy,
    })
    await this.events.publish(EVENTS.RESOURCE_DOWNTIME_OPENED, { id: row.id, tenantId, resourceId: row.resourceId }, tenantId)
    return toResourceDowntimeDto(row)
  }

  /**
   * "Bring the line back up" — end an outage early. If the window is in effect,
   * truncate `to = now` (honest history: it WAS down from→now); if it hasn't
   * started yet, retract it (`isActive = false` — it never took effect); if it's
   * already over, no-op. Idempotent.
   * @throws AppException RESOURCE_DOWNTIME_NOT_FOUND - no such window in the tenant
   */
  async closeDowntimeNow(tenantId: string, id: string): Promise<ResourceDowntimeDto> {
    const existing = await this.repo.findDowntime(tenantId, id)
    if (!existing) throw new AppException(HttpStatus.NOT_FOUND, 'Downtime window not found', ERROR_CODES.RESOURCE_DOWNTIME_NOT_FOUND)
    const now = new Date()
    if (now.getTime() >= existing.toTs.getTime()) return toResourceDowntimeDto(existing) // already over
    const patch = now.getTime() <= existing.fromTs.getTime() ? { isActive: false } : { toTs: now }
    const row = await this.repo.updateDowntime(tenantId, id, patch)
    return toResourceDowntimeDto(row!)
  }

  /**
   * Retracts a downtime window (soft-delete) — a record opened in error.
   * @throws AppException RESOURCE_DOWNTIME_NOT_FOUND - no such window in the tenant
   */
  async retractDowntime(tenantId: string, id: string): Promise<ResourceDowntimeDto> {
    const row = await this.repo.updateDowntime(tenantId, id, { isActive: false })
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Downtime window not found', ERROR_CODES.RESOURCE_DOWNTIME_NOT_FOUND)
    return toResourceDowntimeDto(row)
  }

  // --- resource group --------------------------------------------------------
  /** Lists the tenant's resource groups, each with its member resource ids. */
  async listResourceGroups(tenantId: string): Promise<ResourceGroupDto[]> {
    const groups = await this.repo.listResourceGroups(tenantId)
    return Promise.all(groups.map(async (g) => toResourceGroupDto(g, await this.repo.memberResourceIds(g.id))))
  }

  /**
   * Creates a resource group, validating its plant (org.read) and that every
   * member resource exists in the tenant (intra-module).
   * @throws AppException INVALID_PLANT_REFERENCE - plant did not resolve
   * @throws AppException INVALID_RESOURCE_REFERENCE - a member resource did not resolve
   */
  async createResourceGroup(tenantId: string, dto: CreateResourceGroupRequest, actor: string = SYSTEM_ACTOR): Promise<ResourceGroupDto> {
    await this.assertPlant(tenantId, dto.plantId)
    await this.assertResourcesExist(tenantId, dto.memberResourceIds)
    const { memberResourceIds, ...fields } = dto
    const row = await this.repo.createResourceGroup({ ...fields, tenantId }, memberResourceIds)
    const changedFields = this.snapshot(row, RESOURCE_GROUP_AUDIT_COLS)
    changedFields['memberResourceIds'] = { new: memberResourceIds }
    await this.writeAudit({
      tenantId,
      entityType: 'resource_group',
      businessKey: row.id,
      versionId: row.id,
      action: 'create',
      actor,
      changedFields,
    })
    await this.events.publish(EVENTS.RESOURCE_GROUP_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toResourceGroupDto(row, memberResourceIds)
  }

  /**
   * Updates a resource group (and its members when supplied).
   * @throws AppException RESOURCE_GROUP_NOT_FOUND - no such group in the tenant
   * @throws AppException INVALID_PLANT_REFERENCE / INVALID_RESOURCE_REFERENCE
   */
  async updateResourceGroup(
    tenantId: string,
    id: string,
    dto: UpdateResourceGroupRequest,
    actor: string = SYSTEM_ACTOR,
  ): Promise<ResourceGroupDto> {
    if (dto.plantId) await this.assertPlant(tenantId, dto.plantId)
    if (dto.memberResourceIds) await this.assertResourcesExist(tenantId, dto.memberResourceIds)
    const before = await this.repo.findResourceGroup(tenantId, id)
    if (!before) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Resource group not found', ERROR_CODES.RESOURCE_GROUP_NOT_FOUND)
    }
    const oldMembers = dto.memberResourceIds ? await this.repo.memberResourceIds(id) : undefined
    const { memberResourceIds, ...fields } = dto
    const row = await this.repo.updateResourceGroup(tenantId, id, fields, memberResourceIds)
    if (!row) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Resource group not found', ERROR_CODES.RESOURCE_GROUP_NOT_FOUND)
    }
    const newMembers = await this.repo.memberResourceIds(id)
    const changedFields = this.diff(before, row, RESOURCE_GROUP_AUDIT_COLS)
    if (memberResourceIds && oldMembers && !this.sameMembers(oldMembers, memberResourceIds)) {
      changedFields['memberResourceIds'] = { old: oldMembers, new: memberResourceIds }
    }
    if (Object.keys(changedFields).length > 0) {
      await this.writeAudit({
        tenantId,
        entityType: 'resource_group',
        businessKey: row.id,
        versionId: row.id,
        action: changedFields['isActive']?.new === false ? 'deactivate' : 'update',
        actor,
        changedFields,
      })
    }
    return toResourceGroupDto(row, newMembers)
  }

  // --- routing + operations --------------------------------------------------
  /** Lists the tenant's routings, each with its ordered operations. */
  async listRoutings(tenantId: string): Promise<RoutingDto[]> {
    const routings = await this.repo.listRoutings(tenantId)
    return Promise.all(routings.map(async (r) => toRoutingDto(r, await this.repo.operationsFor(r.id))))
  }

  /**
   * Resolves one routing (with operations) in the tenant.
   * @throws AppException ROUTING_NOT_FOUND - no such routing in the tenant
   */
  async getRouting(tenantId: string, id: string): Promise<RoutingDto> {
    const row = await this.repo.findRouting(tenantId, id)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Routing not found', ERROR_CODES.ROUTING_NOT_FOUND)
    return toRoutingDto(row, await this.repo.operationsFor(id))
  }

  /**
   * Creates a routing for a part, validating the part and every operation's
   * resource group (intra-module). Emits `master_data.routing.created`.
   * @throws AppException PART_NOT_FOUND - the routing's part did not resolve
   * @throws AppException INVALID_RESOURCE_GROUP_REFERENCE - an op's group did not resolve
   */
  async createRouting(tenantId: string, dto: CreateRoutingRequest): Promise<RoutingDto> {
    await this.assertPartExists(tenantId, dto.partId)
    await this.assertResourceGroupsExist(tenantId, dto.operations.map((o) => o.resourceGroupId))
    const { operations, ...fields } = dto
    const row = await this.repo.createRouting({ ...fields, tenantId }, operations)
    await this.events.publish(EVENTS.ROUTING_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toRoutingDto(row, await this.repo.operationsFor(row.id))
  }

  /**
   * Updates a routing header and (when supplied) replaces its operation set.
   * @throws AppException ROUTING_NOT_FOUND - no such routing in the tenant
   * @throws AppException PART_NOT_FOUND / INVALID_RESOURCE_GROUP_REFERENCE
   */
  async updateRouting(tenantId: string, id: string, dto: UpdateRoutingRequest): Promise<RoutingDto> {
    if (dto.partId) await this.assertPartExists(tenantId, dto.partId)
    if (dto.operations) {
      await this.assertResourceGroupsExist(tenantId, dto.operations.map((o) => o.resourceGroupId))
    }
    const { operations, ...fields } = dto
    const row = await this.repo.updateRouting(tenantId, id, fields, operations)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Routing not found', ERROR_CODES.ROUTING_NOT_FOUND)
    return toRoutingDto(row, await this.repo.operationsFor(id))
  }

  // --- certification ---------------------------------------------------------
  /** Lists the tenant's certifications. */
  async listCertifications(tenantId: string): Promise<CertificationDto[]> {
    return (await this.repo.listCertifications(tenantId)).map(toCertificationDto)
  }

  /**
   * Creates a certification.
   * @throws AppException DUPLICATE_CERTIFICATION_CODE - `code` already used in the tenant
   */
  async createCertification(tenantId: string, dto: CreateCertificationRequest): Promise<CertificationDto> {
    if (await this.repo.findCertificationByCode(tenantId, dto.code)) {
      throw new AppException(HttpStatus.CONFLICT, 'Certification code already exists', ERROR_CODES.DUPLICATE_CERTIFICATION_CODE)
    }
    const row = await this.repo.createCertification({ ...dto, tenantId })
    await this.events.publish(EVENTS.CERTIFICATION_CREATED, { id: row.id, tenantId, name: row.code }, tenantId)
    return toCertificationDto(row)
  }

  /**
   * Updates a certification in the tenant.
   * @throws AppException CERTIFICATION_NOT_FOUND - no such certification in the tenant
   * @throws AppException DUPLICATE_CERTIFICATION_CODE - the new `code` collides
   */
  async updateCertification(tenantId: string, id: string, dto: UpdateCertificationRequest): Promise<CertificationDto> {
    if (dto.code) {
      const existing = await this.repo.findCertificationByCode(tenantId, dto.code)
      if (existing && existing.id !== id) {
        throw new AppException(HttpStatus.CONFLICT, 'Certification code already exists', ERROR_CODES.DUPLICATE_CERTIFICATION_CODE)
      }
    }
    const row = await this.repo.updateCertification(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Certification not found', ERROR_CODES.CERTIFICATION_NOT_FOUND)
    return toCertificationDto(row)
  }

  // --- operator + qualifications ---------------------------------------------
  /** Lists the tenant's operators, each with the certification ids they hold. */
  async listOperators(tenantId: string): Promise<OperatorDto[]> {
    const operators = await this.repo.listOperators(tenantId)
    return Promise.all(
      operators.map(async (o) => toOperatorDto(o, await this.repo.certificationIdsForOperator(o.id))),
    )
  }

  /**
   * Creates an operator (externally-sourced stub), validating its home plant.
   * @throws AppException INVALID_PLANT_REFERENCE - home plant did not resolve
   */
  async createOperator(tenantId: string, dto: CreateOperatorRequest): Promise<OperatorDto> {
    await this.assertPlant(tenantId, dto.homePlantId)
    const row = await this.repo.createOperator({ ...dto, tenantId })
    await this.events.publish(EVENTS.OPERATOR_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toOperatorDto(row, [])
  }

  /**
   * Updates an operator in the tenant.
   * @throws AppException OPERATOR_NOT_FOUND - no such operator in the tenant
   * @throws AppException INVALID_PLANT_REFERENCE - the new home plant did not resolve
   */
  async updateOperator(tenantId: string, id: string, dto: UpdateOperatorRequest): Promise<OperatorDto> {
    if (dto.homePlantId) await this.assertPlant(tenantId, dto.homePlantId)
    const row = await this.repo.updateOperator(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Operator not found', ERROR_CODES.OPERATOR_NOT_FOUND)
    return toOperatorDto(row, await this.repo.certificationIdsForOperator(id))
  }

  /**
   * Toggles one operator×certification qualification (the matrix screen, FS6).
   * @throws AppException OPERATOR_NOT_FOUND - no such operator in the tenant
   * @throws AppException CERTIFICATION_NOT_FOUND - no such certification in the tenant
   */
  async setOperatorQualification(
    tenantId: string,
    operatorId: string,
    dto: SetOperatorQualificationRequest,
  ): Promise<OperatorDto> {
    const op = await this.repo.findOperator(tenantId, operatorId)
    if (!op) throw new AppException(HttpStatus.NOT_FOUND, 'Operator not found', ERROR_CODES.OPERATOR_NOT_FOUND)
    if (!(await this.repo.findCertification(tenantId, dto.certificationId))) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Certification not found', ERROR_CODES.CERTIFICATION_NOT_FOUND)
    }
    await this.repo.setQualification(tenantId, operatorId, dto.certificationId, dto.qualified)
    return toOperatorDto(op, await this.repo.certificationIdsForOperator(operatorId))
  }

  // --- audit (Pattern B — §6) ------------------------------------------------
  /**
   * Appends one master-data audit row. Append-only; `effectiveFrom`/`sourceRef`
   * are Pattern-A (revise) concerns and stay null here. Actor is the JWT user id
   * or the `'system'` sentinel — never null.
   */
  private async writeAudit(params: {
    tenantId: string
    entityType: MasterDataEntityType
    businessKey: string
    versionId: string
    action: MasterDataAuditAction
    actor: string
    changedFields: Record<string, MasterDataAuditChange>
  }): Promise<void> {
    await this.repo.appendAudit([
      {
        tenantId: params.tenantId,
        entityType: params.entityType,
        businessKey: params.businessKey,
        versionId: params.versionId,
        action: params.action,
        actor: params.actor,
        sourceRef: null,
        effectiveFrom: null,
        changedFields: params.changedFields,
      },
    ])
  }

  /** Full snapshot of the tracked columns for a `create` audit (`{ new }`, no prior). */
  private snapshot(row: Record<string, unknown>, cols: readonly string[]): Record<string, MasterDataAuditChange> {
    const out: Record<string, MasterDataAuditChange> = {}
    for (const c of cols) out[c] = { new: row[c] ?? null }
    return out
  }

  /** Only the tracked columns whose value actually changed (`{ old, new }`) — unchanged fields omitted. */
  private diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    cols: readonly string[],
  ): Record<string, MasterDataAuditChange> {
    const out: Record<string, MasterDataAuditChange> = {}
    for (const c of cols) {
      const old = before[c] ?? null
      const next = after[c] ?? null
      if (old !== next) out[c] = { old, new: next }
    }
    return out
  }

  /** Order-independent membership equality (resource-group member set). */
  private sameMembers(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    const set = new Set(a)
    return b.every((x) => set.has(x))
  }

  // --- internal validation ---------------------------------------------------
  /** Validates a kernel plant reference through org.read (O4). */
  private async assertPlant(tenantId: string, plantId: string): Promise<void> {
    const { invalid } = await this.org.validatePlantIds(tenantId, [plantId])
    if (invalid.length > 0) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Plant not found', ERROR_CODES.INVALID_PLANT_REFERENCE)
    }
  }

  /** Validates a kernel calendar reference through org.read 1.1 (O4). */
  private async assertCalendar(tenantId: string, calendarId: string): Promise<void> {
    const { invalid } = await this.org.validateCalendarIds(tenantId, [calendarId])
    if (invalid.length > 0) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Calendar not found', ERROR_CODES.INVALID_CALENDAR_REFERENCE)
    }
  }

  private async assertPartExists(tenantId: string, partId: string): Promise<void> {
    const found = await this.repo.partIdsIn(tenantId, [partId])
    if (found.length === 0) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Part not found', ERROR_CODES.PART_NOT_FOUND)
    }
  }

  private async assertResourcesExist(tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const found = await this.repo.resourceIdsIn(tenantId, ids)
    if (found.length !== new Set(ids).size) {
      throw new AppException(HttpStatus.NOT_FOUND, 'One or more resources not found', ERROR_CODES.INVALID_RESOURCE_REFERENCE)
    }
  }

  private async assertResourceGroupsExist(tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const found = await this.repo.resourceGroupIdsIn(tenantId, ids)
    if (found.length !== new Set(ids).size) {
      throw new AppException(HttpStatus.NOT_FOUND, 'One or more resource groups not found', ERROR_CODES.INVALID_RESOURCE_GROUP_REFERENCE)
    }
  }
}
