import { z } from 'zod'

/**
 * Scheduling module client↔API contract (phase 2 — api-spec §11). The scheduling
 * module is a CONSUMER of `masterdata.read` (via the binding resolver) and a
 * PRODUCER of the committed schedule the board renders. It publishes no
 * inter-module read contract this phase (no consumer yet). DTOs are response
 * shapes; the request schemas validate the solve/commit writes.
 *
 * Deterministic spine only (D2). `setup_source`/`cycle_source` default `standard`
 * and `*_confidence` are null — wired now, flipped by Phase 3's closed loop with
 * zero schema/board change (SKIP-04).
 */

// --- enums -------------------------------------------------------------------

export const demandTypeSchema = z.enum(['JIT', 'JIS', 'stock'])
export type DemandType = z.infer<typeof demandTypeSchema>

export const firmnessSchema = z.enum(['firm', 'forecast'])
export type Firmness = z.infer<typeof firmnessSchema>

export const scheduleVersionStatusSchema = z.enum(['draft', 'committed', 'superseded'])
export type ScheduleVersionStatus = z.infer<typeof scheduleVersionStatusSchema>

export const optimizerRunStatusSchema = z.enum(['success', 'infeasible', 'failed'])
export type OptimizerRunStatus = z.infer<typeof optimizerRunStatusSchema>

export const optimizerTriggerSchema = z.enum(['manual', 'scheduled', 'event', 'what_if'])
export type OptimizerTrigger = z.infer<typeof optimizerTriggerSchema>

/** Whether a planning time is the master-data baseline or an ML correction (D7/SKIP-04). */
export const timeSourceSchema = z.enum(['standard', 'ml_adjusted'])
export type TimeSource = z.infer<typeof timeSourceSchema>

// --- DTOs --------------------------------------------------------------------

export interface DemandInputDto {
  id: string
  demandLineId: string
  releaseReference: string | null
  /** → master-data part (resolved via masterdata.read). */
  partId: string
  plantId: string
  customerId: string
  programId: string | null
  demandType: DemandType
  firmness: Firmness
  requiredQty: number
  uom: string
  /** ISO timestamp. */
  requiredDate: string
  isActive: boolean
}

export interface OptimizerRunDto {
  id: string
  plantId: string
  trigger: OptimizerTrigger
  objectiveSummary: string
  status: OptimizerRunStatus
  stopReason: string | null
  startedAt: string
  finishedAt: string | null
  inputDemandCount: number
}

export interface ScheduleVersionDto {
  id: string
  plantId: string
  status: ScheduleVersionStatus
  horizonStart: string
  horizonEnd: string
  optimizerRunId: string
  supersedesVersionId: string | null
  createdAt: string
}

export interface ScheduledOperationDto {
  id: string
  scheduleVersionId: string
  demandLineId: string
  /** → master-data part / routing-operation / resource (resolved via masterdata.read). */
  partId: string
  routingOperationId: string
  resourceId: string
  opSeq: number
  sequencePosition: number
  plannedStart: string
  plannedEnd: string
  plannedQty: number
  setupTime: number
  cycleTime: number
  setupSource: TimeSource
  cycleSource: TimeSource
  /** Null until Phase 3's ML closed loop populates it (SKIP-04). */
  setupConfidence: number | null
  cycleConfidence: number | null
  atRisk: boolean
  atRiskReason: string | null
}

/** Board payload: a version header + its run + ordered scheduled operations. */
export interface ScheduleVersionDetailDto {
  version: ScheduleVersionDto
  run: OptimizerRunDto
  operations: ScheduledOperationDto[]
}

// --- request schemas ---------------------------------------------------------

/** `POST /admin/scheduling/solve` — run the deterministic sequencer for a plant. */
export const solveScheduleSchema = z.object({ plantId: z.string().min(1) }).strict()
export type SolveScheduleRequest = z.infer<typeof solveScheduleSchema>
