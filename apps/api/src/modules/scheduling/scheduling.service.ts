import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import {
  MASTERDATA_READ_CONTRACT,
  type MasterDataReadContract,
  type OrgPriority,
  type OrgReadContract,
  type PartDto,
  type ResourceDto,
  type ScheduleVersionDetailDto,
  type ScheduleVersionDto,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { EVENTS } from '../../events'
import { BindingResolver } from '../binding/binding.resolver'
import { EventBus } from '../eventbus/event-bus'
import { ORG_READ } from '../org/org-read.service'
import {
  toDemandInputDto,
  toOptimizerRunDto,
  toScheduledOperationDto,
  toScheduleVersionDto,
} from './scheduling.mapper'
import { SchedulingRepository } from './scheduling.repository'
import { sequence, type SequencerItem } from './sequencer'

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, standard: 2 }

/**
 * Scheduling domain service (phase 2). **Consumes master-data ONLY through the
 * binding-resolved `masterdata.read` contract** (O7 — `this.resolveMasterData`),
 * never master-data's tables/code; kernel `org.read` is consumed directly. Runs
 * the deterministic sequencer (SKIP-03 stand-in) over seeded demand and persists
 * a `draft` schedule version; a separate `commit` promotes it (AS11).
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly bindings: BindingResolver,
    @Inject(ORG_READ) private readonly org: OrgReadContract,
    private readonly events: EventBus,
  ) {}

  /** Resolve the master-data contract bound to this tenant (the binding indirection, O7). */
  private resolveMasterData(tenantId: string): Promise<MasterDataReadContract> {
    return this.bindings.resolve<MasterDataReadContract>(tenantId, MASTERDATA_READ_CONTRACT)
  }

  // --- reads -----------------------------------------------------------------
  /** Lists the plant's schedule versions (newest first) for the board selector. */
  async listVersions(tenantId: string, plantId: string): Promise<ScheduleVersionDto[]> {
    return (await this.repo.listVersions(tenantId, plantId)).map(toScheduleVersionDto)
  }

  /**
   * One version + its run + ordered operations (board payload).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND
   */
  async versionDetail(tenantId: string, id: string): Promise<ScheduleVersionDetailDto> {
    const version = await this.repo.findVersion(tenantId, id)
    if (!version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    const run = await this.repo.findRun(tenantId, version.optimizerRunId)
    const ops = await this.repo.operationsForVersion(version.id)
    return {
      version: toScheduleVersionDto(version),
      run: toOptimizerRunDto(run!),
      operations: ops.map(toScheduledOperationDto),
    }
  }

  /** Lists the plant's seeded demand (read-only). */
  async listDemand(tenantId: string, plantId: string) {
    return (await this.repo.listDemand(tenantId, plantId)).map(toDemandInputDto)
  }

  /** Board rows: the plant's resources, via the bound `masterdata.read`. */
  async listResources(tenantId: string, plantId: string): Promise<ResourceDto[]> {
    const md = await this.resolveMasterData(tenantId)
    return (await md.listResources(tenantId)).filter((r) => r.plantId === plantId)
  }

  // --- solve (deterministic sequencer) ---------------------------------------
  /**
   * Runs the deterministic sequencer for a plant and persists a `draft` version.
   * Reads parts/routings/resources through the binding-resolved `masterdata.read`.
   * @throws AppException NO_DEMAND_TO_SCHEDULE - no active demand for the plant
   * @throws AppException SCHEDULE_INFEASIBLE - a line has no routing / no eligible resource (D4 hard gate)
   */
  async solve(tenantId: string, plantId: string): Promise<ScheduleVersionDto> {
    const startedAt = new Date()
    const md = await this.resolveMasterData(tenantId)
    const demand = await this.repo.activeDemand(tenantId, plantId)
    if (demand.length === 0) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'No active demand to schedule', ERROR_CODES.NO_DEMAND_TO_SCHEDULE)
    }

    const resources = await md.listResources(tenantId)
    const activeResourceIds = new Set(resources.filter((r) => r.status === 'active').map((r) => r.id))
    const partCache = new Map<string, PartDto | null>()
    const priorityCache = new Map<string, number>()

    const items: SequencerItem[] = []
    let infeasibleReason: string | null = null

    for (const line of demand) {
      const part = partCache.get(line.partId) ?? (await md.getPart(tenantId, line.partId))
      partCache.set(line.partId, part)
      const routing = await md.getPrimaryRoutingForPart(tenantId, line.partId)
      if (!part || !routing || routing.operations.length === 0) {
        infeasibleReason = `Demand ${line.demandLineId}: no active primary routing for part ${line.partId}`
        break
      }
      const priorityRank = await this.priorityRankFor(tenantId, line.customerId, line.programId, priorityCache)
      for (const op of routing.operations) {
        const group = await md.getResourceGroup(tenantId, op.resourceGroupId)
        const eligible = (group?.memberResourceIds ?? []).filter((id) => activeResourceIds.has(id)).sort()
        if (eligible.length === 0) {
          infeasibleReason = `Demand ${line.demandLineId}: no eligible active resource for op ${op.opSeq}`
          break
        }
        items.push({
          demandLineId: line.demandLineId,
          partId: line.partId,
          partNo: part.partNo,
          routingOperationId: op.id,
          opSeq: op.opSeq,
          changeoverValue: changeoverValueFor(part, op.changeoverAttributeKey),
          qty: line.requiredQty,
          setupTime: op.stdSetupTime,
          cycleTime: op.stdCycleTime,
          requiredDate: line.requiredDate.getTime(),
          firmness: line.firmness,
          priorityRank,
          eligibleResourceIds: eligible,
        })
      }
      if (infeasibleReason) break
    }

    // Hard gate (D4): an unresolvable line / no eligible resource → infeasible run, NO version.
    if (infeasibleReason) {
      await this.repo.createRun({
        tenantId,
        plantId,
        trigger: 'manual',
        objectiveSummary: 'EDD changeover-aware (SKIP-03 stand-in)',
        status: 'infeasible',
        stopReason: infeasibleReason,
        startedAt,
        finishedAt: new Date(),
        inputDemandCount: demand.length,
      })
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, infeasibleReason, ERROR_CODES.SCHEDULE_INFEASIBLE)
    }

    const result = sequence(items)
    const run = await this.repo.createRun({
      tenantId,
      plantId,
      trigger: 'manual',
      objectiveSummary: 'EDD changeover-aware (SKIP-03 stand-in)',
      status: 'success',
      stopReason: `completed: ${result.placements.length} operations placed`,
      startedAt,
      finishedAt: new Date(),
      inputDemandCount: demand.length,
    })
    const version = await this.repo.createVersionWithOps(
      {
        tenantId,
        plantId,
        status: 'draft',
        horizonStart: new Date(result.horizonStartMs),
        horizonEnd: new Date(result.horizonEndMs),
        optimizerRunId: run.id,
      },
      result.placements.map((p) => ({
        demandLineId: p.demandLineId,
        partId: p.partId,
        routingOperationId: p.routingOperationId,
        resourceId: p.resourceId,
        opSeq: p.opSeq,
        sequencePosition: p.sequencePosition,
        plannedStart: new Date(p.plannedStartMs),
        plannedEnd: new Date(p.plannedEndMs),
        plannedQty: p.qty,
        setupTime: p.setupTime,
        cycleTime: p.cycleTime,
        atRisk: p.atRisk,
        atRiskReason: p.atRiskReason,
      })),
    )
    await this.events.publish(EVENTS.SCHEDULING_RUN_COMPLETED, { id: run.id, tenantId, name: plantId }, tenantId)
    return toScheduleVersionDto(version)
  }

  /**
   * Promotes a `draft` version to `committed`, superseding the plant's prior
   * committed (AS11). The seam the Phase-3 approval policy will gate (SKIP-46).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND
   */
  async commit(tenantId: string, id: string): Promise<ScheduleVersionDto> {
    const version = await this.repo.findVersion(tenantId, id)
    if (!version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    if (version.status === 'committed') return toScheduleVersionDto(version)
    const prior = await this.repo.findCommittedVersion(tenantId, version.plantId)
    if (prior && prior.id !== version.id) {
      await this.repo.updateVersionStatus(tenantId, prior.id, { status: 'superseded' })
    }
    const updated = await this.repo.updateVersionStatus(tenantId, id, {
      status: 'committed',
      supersedesVersionId: prior?.id ?? null,
    })
    await this.events.publish(EVENTS.SCHEDULING_VERSION_COMMITTED, { id, tenantId, name: version.plantId }, tenantId)
    return toScheduleVersionDto(updated!)
  }

  // --- internal --------------------------------------------------------------
  /** Priority rank from org: program override, else customer default (MD15). */
  private async priorityRankFor(
    tenantId: string,
    customerId: string,
    programId: string | null,
    cache: Map<string, number>,
  ): Promise<number> {
    const key = `${customerId}:${programId ?? ''}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    let priority: OrgPriority = 'standard'
    if (programId) {
      const program = await this.org.getProgram(tenantId, programId)
      if (program?.priority) priority = program.priority
      else {
        const customer = await this.org.getCustomer(tenantId, customerId)
        if (customer) priority = customer.priority
      }
    } else {
      const customer = await this.org.getCustomer(tenantId, customerId)
      if (customer) priority = customer.priority
    }
    const rank = PRIORITY_RANK[priority] ?? 2
    cache.set(key, rank)
    return rank
  }
}

/** The part's attribute value that the op's changeover key points at (AS6). */
function changeoverValueFor(part: PartDto, key: string | null): string | null {
  switch (key) {
    case 'colour':
      return part.colour
    case 'material':
      return part.material
    case 'gauge':
      return part.gauge
    default:
      return null
  }
}
