import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { executionActualSchema, type ExecutionActualPayload } from '@perduraflow/contracts'
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

  /** `GET /learning/predictions` — live forecasts + dispositions (Exception Queue, board flags). */
  @Get('predictions')
  listPredictions(@CurrentUser() user: JwtPayload) {
    return this.read.listPredictions(user.tenantId)
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
