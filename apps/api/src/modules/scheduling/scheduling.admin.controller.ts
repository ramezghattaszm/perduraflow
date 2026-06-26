import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common'
import {
  applyOptionSchema,
  assignOperatorSchema,
  solveScheduleSchema,
  type ApplyOptionRequest,
  type AssignOperatorRequest,
  type SolveScheduleRequest,
} from '@perduraflow/contracts'
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
   * `DELETE /admin/scheduling/versions/:id` — soft-delete a DRAFT version (status → discarded).
   * Rejects committed/superseded (immutable record). Both guards.
   */
  @Delete('versions/:id')
  discardDraft(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.scheduling.discardDraft(user.tenantId, id)
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

  /**
   * `POST /admin/scheduling/operator-assignments` — assign/switch the operator on a resource (C5
   * planner lever, replace-open per resource). The engine reacts on the next re-solve (no auto-solve).
   */
  @Post('operator-assignments')
  assignOperator(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(assignOperatorSchema)) dto: AssignOperatorRequest,
  ) {
    return this.scheduling.assignOperator(user.tenantId, dto)
  }

  /** `DELETE /admin/scheduling/operator-assignments/:id` — unassign (the line reverts to standard). */
  @Delete('operator-assignments/:id')
  unassignOperator(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.scheduling.unassignOperator(user.tenantId, id)
  }
}
