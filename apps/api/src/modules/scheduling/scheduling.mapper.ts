import type {
  DemandInputDto,
  OptimizerRunDto,
  ScheduledOperationDto,
  ScheduleVersionDto,
} from '@perduraflow/contracts'
import type { DemandInput, OptimizerRun, ScheduledOperation, ScheduleVersion } from './schema'

/** Map a demand-input row to its DTO. */
export const toDemandInputDto = (d: DemandInput): DemandInputDto => ({
  id: d.id,
  demandLineId: d.demandLineId,
  releaseReference: d.releaseReference,
  partNo: d.partNo,
  plantId: d.plantId,
  customerId: d.customerId,
  programId: d.programId,
  demandType: d.demandType,
  firmness: d.firmness,
  requiredQty: d.requiredQty,
  uom: d.uom,
  requiredDate: d.requiredDate.toISOString(),
  isActive: d.isActive,
})

/** Map an optimizer-run row to its DTO. */
export const toOptimizerRunDto = (r: OptimizerRun): OptimizerRunDto => ({
  id: r.id,
  plantId: r.plantId,
  trigger: r.trigger,
  objectiveSummary: r.objectiveSummary,
  status: r.status,
  stopReason: r.stopReason,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  inputDemandCount: r.inputDemandCount,
})

/** Map a schedule-version row to its DTO. */
export const toScheduleVersionDto = (v: ScheduleVersion): ScheduleVersionDto => ({
  id: v.id,
  plantId: v.plantId,
  status: v.status,
  horizonStart: v.horizonStart.toISOString(),
  horizonEnd: v.horizonEnd.toISOString(),
  optimizerRunId: v.optimizerRunId,
  supersedesVersionId: v.supersedesVersionId,
  createdAt: v.createdAt.toISOString(),
})

/** Map a scheduled-operation row to its DTO. */
export const toScheduledOperationDto = (o: ScheduledOperation): ScheduledOperationDto => ({
  id: o.id,
  scheduleVersionId: o.scheduleVersionId,
  demandLineId: o.demandLineId,
  partId: o.partId,
  routingOperationId: o.routingOperationId,
  resourceId: o.resourceId,
  opSeq: o.opSeq,
  sequencePosition: o.sequencePosition,
  plannedStart: o.plannedStart.toISOString(),
  plannedEnd: o.plannedEnd.toISOString(),
  plannedQty: o.plannedQty,
  setupTime: o.setupTime,
  cycleTime: o.cycleTime,
  setupSource: o.setupSource,
  cycleSource: o.cycleSource,
  setupConfidence: o.setupConfidence,
  cycleConfidence: o.cycleConfidence,
  atRisk: o.atRisk,
  atRiskReason: o.atRiskReason,
})
