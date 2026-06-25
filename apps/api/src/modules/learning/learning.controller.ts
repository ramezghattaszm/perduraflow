import { Body, Controller, Get, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common'
import { executionActualSchema, type ExecutionActualPayload } from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { LearningReadService } from './learning-read.service'
import { LearningService } from './learning.service'

/**
 * Authenticated read routes for learning (`GET /learning/*`). Tenant-scoped from
 * the JWT. The board's learned-parameter panel + variance count consume these; the
 * demo path feeds actuals via the EventBus (the manual POST is for completeness).
 */
@Controller('learning')
@UseGuards(JwtAuthGuard)
export class LearningController {
  constructor(
    private readonly read: LearningReadService,
    private readonly learning: LearningService,
  ) {}

  /** `GET /learning/parameters` — all learned overlays for the tenant (board/panel). */
  @Get('parameters')
  listParameters(@CurrentUser() user: JwtPayload) {
    return this.read.listLearnedParameters(user.tenantId)
  }

  /** `POST /learning/actuals` — manual actual entry (completeness; demo uses the event). */
  @Post('actuals')
  async recordActual(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(executionActualSchema)) body: ExecutionActualPayload,
  ) {
    await this.learning.ingest(body, user.tenantId)
    return { ok: true }
  }

  /**
   * `GET /learning/predictions?plantId=` — live forecasts for ONE plant (Exception Queue, board
   * flags). `plantId` is REQUIRED: predictions are plant-scoped at the endpoint (like every other
   * plant read), so a screen never shows another plant's forecasts.
   */
  @Get('predictions')
  listPredictions(@CurrentUser() user: JwtPayload, @Query('plantId') plantId?: string) {
    if (!plantId) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'plantId is required', ERROR_CODES.VALIDATION_ERROR)
    }
    return this.read.listPredictionsForPlant(user.tenantId, plantId)
  }

  /** `POST /learning/predictions/:id/approve` — human-dispose a queued prediction (ConfigureGuard). */
  @Post('predictions/:id/approve')
  @UseGuards(ConfigureGuard)
  async approvePrediction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.learning.approvePrediction(user.tenantId, id)
    return { ok: true }
  }

  /** `POST /learning/predictions/:id/dismiss` — reject a queued prediction (ConfigureGuard). */
  @Post('predictions/:id/dismiss')
  @UseGuards(ConfigureGuard)
  async dismissPrediction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.learning.dismissPrediction(user.tenantId, id)
    return { ok: true }
  }
}
