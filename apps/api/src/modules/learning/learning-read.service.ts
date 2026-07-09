import { Injectable } from '@nestjs/common'
import {
  LEARNING_READ_CONTRACT,
  ASSET_READ_CONTRACT,
  type ExecutionActualDto,
  type LearnedParameterDto,
  type LearningParam,
  type LearningReadContract,
  type AssetReadContract,
  type ParameterPredictionDto,
} from '@perduraflow/contracts'
import { BindingResolver } from '../binding/binding.resolver'
import {
  toExecutionActualDto,
  toLearnedParameterDto,
  toParameterPredictionDto,
} from './learning.mapper'
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

  constructor(
    private readonly repo: LearningRepository,
    private readonly bindings: BindingResolver,
  ) {}

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

  /** Actuals for a set of resources whose `actualStart` falls in `[startMs, endMs)` — the
   *  cross-version executed-past population for continuous plant KPIs (each row keeps its own
   *  executing version; nothing is moved). The caller resolves the plant's resource ids. */
  async listActualsForResourcesInWindow(
    tenantId: string,
    resourceIds: string[],
    startMs: number,
    endMs: number,
  ): Promise<ExecutionActualDto[]> {
    return (await this.repo.listActualsForResourcesInWindow(tenantId, resourceIds, startMs, endMs)).map(toExecutionActualDto)
  }

  /** Persisted actuals for a version — scheduling's variance/OEE/cost join (4.4↔4.3). */
  async listActualsForVersion(tenantId: string, scheduleVersionId: string): Promise<ExecutionActualDto[]> {
    return (await this.repo.listActualsForVersion(tenantId, scheduleVersionId)).map(toExecutionActualDto)
  }

  /** The live forecast for one parameter, or null (phase 4). */
  async getPrediction(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
  ): Promise<ParameterPredictionDto | null> {
    const row = await this.repo.findLivePrediction(tenantId, resourceId, routingOperationId, param)
    return row ? toParameterPredictionDto(row) : null
  }

  /**
   * All live forecasts for the tenant — the published-contract surface (no plant scope). Consumed
   * in-process by scheduling/what-if (collision detection over every line). The HTTP exception-queue
   * surface uses {@link listPredictionsForPlant} instead, so a screen never sees another plant's rows.
   */
  async listPredictions(tenantId: string): Promise<ParameterPredictionDto[]> {
    return (await this.repo.listLivePredictions(tenantId)).map(toParameterPredictionDto)
  }

  /**
   * Live forecasts for ONE plant (the Exception Queue / board surface). Plant scope is resolved
   * server-side via `masterdata.read` — predictions key on `resourceId`, so we keep only those whose
   * resource belongs to the plant. Mirrors every other plant-scoped read (filter at the endpoint).
   */
  async listPredictionsForPlant(tenantId: string, plantId: string): Promise<ParameterPredictionDto[]> {
    const asset = await this.bindings.resolve<AssetReadContract>(tenantId, ASSET_READ_CONTRACT)
    const plantResourceIds = new Set((await asset.listResources(tenantId)).filter((r) => r.plantId === plantId).map((r) => r.id))
    return (await this.repo.listLivePredictions(tenantId))
      .filter((p) => plantResourceIds.has(p.resourceId))
      .map(toParameterPredictionDto)
  }

  /** Plant-scoped SET-ASIDE forecasts (dismissed / reverted) — the Exception Queue's "Set aside" list.
   *  Same server-side plant-scoping as {@link listPredictionsForPlant} so a screen never sees another
   *  plant's rows. */
  async listSetAsidePredictionsForPlant(tenantId: string, plantId: string): Promise<ParameterPredictionDto[]> {
    const asset = await this.bindings.resolve<AssetReadContract>(tenantId, ASSET_READ_CONTRACT)
    const plantResourceIds = new Set((await asset.listResources(tenantId)).filter((r) => r.plantId === plantId).map((r) => r.id))
    return (await this.repo.listSetAsidePredictions(tenantId))
      .filter((p) => plantResourceIds.has(p.resourceId))
      .map(toParameterPredictionDto)
  }
}
