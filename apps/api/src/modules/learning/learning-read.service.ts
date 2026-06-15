import { Injectable } from '@nestjs/common'
import {
  LEARNING_READ_CONTRACT,
  type ExecutionActualDto,
  type LearnedParameterDto,
  type LearningParam,
  type LearningReadContract,
} from '@perduraflow/contracts'
import { toExecutionActualDto, toLearnedParameterDto } from './learning.mapper'
import { LearningRepository } from './learning.repository'

/** DI token for the published `learning.read 1.0` interface (A14 platform capability). */
export const LEARNING_READ = Symbol('LEARNING_READ')

/**
 * In-process implementation of `learning.read 1.0` (api-spec §12.9). The surface
 * scheduling consumes **directly** (A14 — not a per-tenant binding) to overlay
 * learned cycle/setup at solve and to join actuals for variance/OEE/cost. Depends
 * only on the contract + DTOs (O1); no transport (O6).
 */
@Injectable()
export class LearningReadService implements LearningReadContract {
  readonly contract = LEARNING_READ_CONTRACT

  constructor(private readonly repo: LearningRepository) {}

  /** The learned overlay for one parameter, or null. */
  async getLearnedParameter(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
  ): Promise<LearnedParameterDto | null> {
    const row = await this.repo.findLearned(tenantId, resourceId, routingOperationId, param)
    return row ? toLearnedParameterDto(row) : null
  }

  /** All learned overlays for the tenant (board/panel). */
  async listLearnedParameters(tenantId: string): Promise<LearnedParameterDto[]> {
    return (await this.repo.listLearned(tenantId)).map(toLearnedParameterDto)
  }

  /** Persisted actuals for a version — scheduling's variance/OEE/cost join (4.4↔4.3). */
  async listActualsForVersion(tenantId: string, scheduleVersionId: string): Promise<ExecutionActualDto[]> {
    return (await this.repo.listActualsForVersion(tenantId, scheduleVersionId)).map(toExecutionActualDto)
  }
}
