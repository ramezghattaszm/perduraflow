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
  type RevisePartRequest,
  type ReviseRoutingRequest,
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
import { MasterDataResolver } from './master-data.resolver'
import {
  type MasterDataAuditAction,
  type MasterDataAuditChange,
  type MasterDataEntityType,
  type NewMasterDataAudit,
  type Part,
  type Routing,
  type RoutingOperation,
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
    private readonly resolver: MasterDataResolver,
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
    await this.assertPartOrgRefs(tenantId, dto.customerId, dto.program)
    // make_buy has no DB default — state it explicitly (a fresh part is 'make' unless specified).
    const row = await this.repo.createPart({ ...dto, tenantId, makeBuy: dto.makeBuy ?? 'make' })
    await this.events.publish(EVENTS.PART_CREATED, { id: row.id, tenantId, name: row.partNo }, tenantId)
    return toPartDto(row)
  }

  /**
   * Edits a part — Pattern A (D-L0-7): **never an in-place UPDATE**. An attribute change is a REVISE,
   * creating a new effectivity-dated version off the current OPEN version (prior window closed, audited).
   * A no-op edit (nothing actually changes) writes nothing and returns the open version unchanged.
   * `revision`/`effectiveFrom` are auto-derived (next label, effective now) when the caller omits them
   * (UI hedge — the explicit-input admin form is a REMAINING-ITEMS follow-up). `part_no` is the durable
   * identity and is not editable here.
   * @throws AppException PART_NOT_FOUND - no such part in the tenant
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - explicit `effectiveFrom` not after the open version's
   */
  async updatePart(tenantId: string, id: string, dto: UpdatePartRequest, actor: string = SYSTEM_ACTOR): Promise<PartDto> {
    const target = await this.repo.findPart(tenantId, id)
    if (!target) throw new AppException(HttpStatus.NOT_FOUND, 'Part not found', ERROR_CODES.PART_NOT_FOUND)
    const open = await this.repo.findOpenPart(tenantId, target.partNo)
    if (!open) throw new AppException(HttpStatus.NOT_FOUND, 'Part not found', ERROR_CODES.PART_NOT_FOUND)
    await this.assertPartOrgRefs(tenantId, dto.customerId, dto.program)
    const changes = this.partEditChanges(dto, open)
    if (Object.keys(changes).length === 0) return toPartDto(open) // no-op → write nothing
    const revision = dto.revision ?? this.nextRevision(open.revision)
    const effectiveFrom = dto.effectiveFrom ?? new Date().toISOString()
    return this.resolver.revisePart(tenantId, open.partNo, { revision, effectiveFrom, ecnRef: null, changes }, actor)
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
    const row = await this.repo.createResourceWithAudit({ ...dto, tenantId }, (r) =>
      this.auditRow({
        tenantId,
        entityType: 'resource',
        businessKey: r.id,
        versionId: r.id,
        action: 'create',
        actor,
        changedFields: this.snapshot(r, RESOURCE_AUDIT_COLS),
      }),
    )
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
    const row = await this.repo.updateResourceWithAudit(tenantId, id, dto, (before, after) => {
      const changedFields = this.diff(before, after, RESOURCE_AUDIT_COLS)
      if (Object.keys(changedFields).length === 0) return null
      return this.auditRow({
        tenantId,
        entityType: 'resource',
        businessKey: after.id,
        versionId: after.id,
        action: changedFields['status']?.new === 'inactive' ? 'deactivate' : 'update',
        actor,
        changedFields,
      })
    })
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Resource not found', ERROR_CODES.RESOURCE_NOT_FOUND)
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
    const row = await this.repo.createResourceGroupWithAudit({ ...fields, tenantId }, memberResourceIds, (r) => {
      const changedFields = this.snapshot(r, RESOURCE_GROUP_AUDIT_COLS)
      changedFields['memberResourceIds'] = { new: memberResourceIds }
      return this.auditRow({
        tenantId,
        entityType: 'resource_group',
        businessKey: r.id,
        versionId: r.id,
        action: 'create',
        actor,
        changedFields,
      })
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
    const { memberResourceIds, ...fields } = dto
    const result = await this.repo.updateResourceGroupWithAudit(
      tenantId,
      id,
      fields,
      memberResourceIds,
      (before, after, oldMembers, newMembers) => {
        const changedFields = this.diff(before, after, RESOURCE_GROUP_AUDIT_COLS)
        if (memberResourceIds && !this.sameMembers(oldMembers, newMembers)) {
          changedFields['memberResourceIds'] = { old: oldMembers, new: newMembers }
        }
        if (Object.keys(changedFields).length === 0) return null
        return this.auditRow({
          tenantId,
          entityType: 'resource_group',
          businessKey: after.id,
          versionId: after.id,
          action: changedFields['isActive']?.new === false ? 'deactivate' : 'update',
          actor,
          changedFields,
        })
      },
    )
    if (!result) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Resource group not found', ERROR_CODES.RESOURCE_GROUP_NOT_FOUND)
    }
    return toResourceGroupDto(result.row, result.members)
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
    await this.assertPartNo(tenantId, dto.partNo)
    await this.assertResourceGroupsExist(tenantId, dto.operations.map((o) => o.resourceGroupId))
    const { operations, ...fields } = dto
    const row = await this.repo.createRouting({ ...fields, tenantId }, operations)
    await this.events.publish(EVENTS.ROUTING_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toRoutingDto(row, await this.repo.operationsFor(row.id))
  }

  /**
   * Edits a routing — Pattern A (D-L0-7): **never an in-place UPDATE**. A header/operation change is a
   * REVISE off the current OPEN version of this routing (prior window closed, op rows copied onto the new
   * version, audited). A no-op edit writes nothing. `revision`/`effectiveFrom` auto-derive when omitted
   * (UI hedge). `part_no` is the identity and not editable here.
   * @throws AppException ROUTING_NOT_FOUND - no such routing in the tenant
   * @throws AppException INVALID_RESOURCE_GROUP_REFERENCE - an op's group did not resolve
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - explicit `effectiveFrom` not after the open version's
   */
  async updateRouting(tenantId: string, id: string, dto: UpdateRoutingRequest, actor: string = SYSTEM_ACTOR): Promise<RoutingDto> {
    const target = await this.repo.findRouting(tenantId, id)
    if (!target) throw new AppException(HttpStatus.NOT_FOUND, 'Routing not found', ERROR_CODES.ROUTING_NOT_FOUND)
    const open = await this.repo.findOpenRouting(tenantId, target.partNo, { name: target.name })
    if (!open) throw new AppException(HttpStatus.NOT_FOUND, 'Routing not found', ERROR_CODES.ROUTING_NOT_FOUND)
    if (dto.operations) {
      await this.assertResourceGroupsExist(tenantId, dto.operations.map((o) => o.resourceGroupId))
    }
    const changes = await this.routingEditChanges(dto, open)
    if (Object.keys(changes).length === 0) {
      return toRoutingDto(open, await this.repo.operationsFor(open.id)) // no-op → write nothing
    }
    const revision = dto.revision ?? this.nextRevision(open.revision)
    const effectiveFrom = dto.effectiveFrom ?? new Date().toISOString()
    return this.resolver.reviseRouting(tenantId, open.partNo, { revision, effectiveFrom, ecnRef: null, name: open.name, changes }, actor)
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
   * Builds one master-data audit row (not persisted here — handed to the repository's atomic
   * `*WithAudit` tx methods so the change and its audit commit or roll back together). `effectiveFrom`
   * /`sourceRef` are Pattern-A (revise) concerns and stay null. Actor is the JWT user id or the
   * `'system'` sentinel — never null.
   */
  private auditRow(params: {
    tenantId: string
    entityType: MasterDataEntityType
    businessKey: string
    versionId: string
    action: MasterDataAuditAction
    actor: string
    changedFields: Record<string, MasterDataAuditChange>
  }): NewMasterDataAudit {
    return {
      tenantId: params.tenantId,
      entityType: params.entityType,
      businessKey: params.businessKey,
      versionId: params.versionId,
      action: params.action,
      actor: params.actor,
      sourceRef: null,
      effectiveFrom: null,
      changedFields: params.changedFields,
    }
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

  // --- Pattern-A edit → revise helpers (D-L0-7) ------------------------------
  /** Next revision label: A→B … Y→Z, then bump a trailing number (Z→Z2, B1→B2), else append '2'. */
  private nextRevision(cur: string): string {
    if (/^[A-Y]$/.test(cur)) return String.fromCharCode(cur.charCodeAt(0) + 1)
    const m = cur.match(/^(.*?)(\d+)$/)
    if (m) return `${m[1]}${Number(m[2]) + 1}`
    return `${cur}2`
  }

  /** The part attributes in `dto` that actually differ from the open version (the revise's `changes`). */
  private partEditChanges(dto: UpdatePartRequest, open: Part): RevisePartRequest['changes'] {
    const cols = ['description', 'partType', 'uom', 'material', 'gauge', 'colour', 'status', 'makeBuy', 'customerPartNo', 'customerId', 'program'] as const
    const out: Record<string, unknown> = {}
    for (const c of cols) {
      const v = (dto as Record<string, unknown>)[c]
      if (v !== undefined && v !== open[c]) out[c] = v
    }
    return out as RevisePartRequest['changes']
  }

  /** The routing header/op changes in `dto` that actually differ from the open version. */
  private async routingEditChanges(dto: UpdateRoutingRequest, open: Routing): Promise<ReviseRoutingRequest['changes']> {
    const out: Record<string, unknown> = {}
    if (dto.name !== undefined && dto.name !== open.name) out['name'] = dto.name
    if (dto.isPrimary !== undefined && dto.isPrimary !== open.isPrimary) out['isPrimary'] = dto.isPrimary
    if (dto.status !== undefined && dto.status !== open.status) out['status'] = dto.status
    if (dto.operations) {
      const current = await this.repo.operationsFor(open.id)
      if (!this.sameOps(current, dto.operations)) out['operations'] = dto.operations
    }
    return out as ReviseRoutingRequest['changes']
  }

  /** Order-independent equality of a routing's operation set (opSeq-keyed field compare). */
  private sameOps(cur: RoutingOperation[], next: NonNullable<ReviseRoutingRequest['changes']['operations']>): boolean {
    if (cur.length !== next.length) return false
    const c = [...cur].sort((a, b) => a.opSeq - b.opSeq)
    const n = [...next].sort((a, b) => a.opSeq - b.opSeq)
    return c.every(
      (o, i) =>
        o.opSeq === n[i]!.opSeq &&
        o.resourceGroupId === n[i]!.resourceGroupId &&
        o.stdSetupTime === n[i]!.stdSetupTime &&
        o.stdCycleTime === n[i]!.stdCycleTime &&
        (o.changeoverAttributeKey ?? null) === (n[i]!.changeoverAttributeKey ?? null),
    )
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

  /** Validates a part's customer/program refs through org.read 1.2 (O4, Layer 1) — nulls skip. */
  private async assertPartOrgRefs(tenantId: string, customerId?: string | null, program?: string | null): Promise<void> {
    if (customerId) {
      const { invalid } = await this.org.validateCustomerIds(tenantId, [customerId])
      if (invalid.length > 0) {
        throw new AppException(HttpStatus.NOT_FOUND, 'Customer not found', ERROR_CODES.INVALID_CUSTOMER_REFERENCE)
      }
    }
    if (program) {
      const { invalid } = await this.org.validateProgramIds(tenantId, [program])
      if (invalid.length > 0) {
        throw new AppException(HttpStatus.NOT_FOUND, 'Program not found', ERROR_CODES.INVALID_PROGRAM_REFERENCE)
      }
    }
  }

  /** Validates a part reference by its durable business key — the `part_no` must have an OPEN version. */
  private async assertPartNo(tenantId: string, partNo: string): Promise<void> {
    const open = await this.repo.findOpenPart(tenantId, partNo)
    if (!open) {
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
