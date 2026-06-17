import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { applyOptionSchema, solveScheduleSchema, type ApplyOptionRequest, type SolveScheduleRequest } from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { SchedulingService } from './scheduling.service'
import { WhatIfService } from './whatif.service'

/**
 * Scheduling writes (`/admin/scheduling/*`). Both guards (API §11): JwtAuthGuard +
 * ConfigureGuard. Tenant-scoped from the JWT.
 */
@Controller('admin/scheduling')
@UseGuards(JwtAuthGuard, ConfigureGuard)
export class SchedulingAdminController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly whatIf: WhatIfService,
  ) {}

  /** `POST /admin/scheduling/solve` — run the deterministic sequencer → a new `draft` version. */
  @Post('solve')
  solve(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(solveScheduleSchema)) dto: SolveScheduleRequest,
  ) {
    return this.scheduling.solve(user.tenantId, dto.plantId)
  }

  /** `POST /admin/scheduling/versions/:id/commit` — promote `draft → committed`, supersede prior. */
  @Post('versions/:id/commit')
  commit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.scheduling.commit(user.tenantId, id)
  }

  /**
   * `POST /admin/scheduling/what-if/:id/apply` — apply a chosen what-if option to a
   * new **draft** version (D26 human action; committed separately). Behind both guards.
   */
  @Post('what-if/:id/apply')
  applyOption(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(applyOptionSchema)) dto: ApplyOptionRequest,
  ) {
    return this.whatIf.applyOption(user.tenantId, id, dto.optionId, user.sub)
  }
}
