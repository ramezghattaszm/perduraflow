import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import {
  baselineSourceSchema,
  narrateRequestSchema,
  whatIfRequestSchema,
  type BaselineSource,
  type NarrateRequest,
  type WhatIfRequest,
} from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { NarrationService } from './narration.service'
import { PlanComparisonService } from './plan-comparison.service'
import { SchedulingService } from './scheduling.service'
import { WhatIfService } from './whatif.service'

/**
 * Authenticated read routes for scheduling (`GET /scheduling/*`). Tenant-scoped
 * from the JWT. The board consumes these; schedule writes (solve/commit/apply) live
 * on the admin controller behind ConfigureGuard. What-if **evaluation** + narration
 * are non-committing user actions and live here.
 */
@Controller('scheduling')
@UseGuards(JwtAuthGuard)
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly whatIf: WhatIfService,
    private readonly planComparison: PlanComparisonService,
    private readonly narration: NarrationService,
  ) {}

  /** `GET /scheduling/versions?plantId=` — the plant's versions (selector). */
  @Get('versions')
  listVersions(@CurrentUser() user: JwtPayload, @Query('plantId') plantId: string) {
    return this.scheduling.listVersions(user.tenantId, plantId)
  }

  /** `GET /scheduling/versions/:id` — version header + run + ordered operations (board data). */
  @Get('versions/:id')
  versionDetail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.scheduling.versionDetail(user.tenantId, id)
  }

  /** `GET /scheduling/demand?plantId=` — the plant's seeded demand (read-only). */
  @Get('demand')
  listDemand(@CurrentUser() user: JwtPayload, @Query('plantId') plantId: string) {
    return this.scheduling.listDemand(user.tenantId, plantId)
  }

  /** `GET /scheduling/resources?plantId=` — board rows, via the bound `masterdata.read`. */
  @Get('resources')
  listResources(@CurrentUser() user: JwtPayload, @Query('plantId') plantId: string) {
    return this.scheduling.listResources(user.tenantId, plantId)
  }

  /** `GET /scheduling/variance?versionId=` — performance variance (board strip + Scorecard). */
  @Get('variance')
  variance(@CurrentUser() user: JwtPayload, @Query('versionId') versionId: string) {
    return this.scheduling.variance(user.tenantId, versionId)
  }

  /**
   * `GET /scheduling/scorecard?plantId=&versionId=` — View 2 metrics for a specific
   * version (its own actuals). `versionId` optional → defaults to latest committed.
   */
  @Get('scorecard')
  scorecard(
    @CurrentUser() user: JwtPayload,
    @Query('plantId') plantId: string,
    @Query('versionId') versionId?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    return this.scheduling.scorecard(user.tenantId, plantId, versionId, resourceId)
  }

  // --- phase 5: what-if + baseline + narration -------------------------------

  /** `POST /scheduling/what-if` — evaluate a change-set → ranked costed option-set (D55). */
  @Post('what-if')
  whatIfEvaluate(@CurrentUser() user: JwtPayload, @Body(new ZodValidationPipe(whatIfRequestSchema)) dto: WhatIfRequest) {
    return this.whatIf.evaluate(user.tenantId, dto.plantId, dto.changeSet, dto.baseVersionId, user.sub)
  }

  /** `GET /scheduling/what-if/:id` — a stored what-if result (the phase-6 substrate read). */
  @Get('what-if/:id')
  whatIfGet(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.whatIf.get(user.tenantId, id)
  }

  /** `POST /scheduling/what-if/:id/narrate` — render the rationale into prose (A19; async/non-blocking). */
  @Post('what-if/:id/narrate')
  narrate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(narrateRequestSchema)) dto: NarrateRequest,
  ) {
    return this.narration.narrate(user.tenantId, id, dto.mode, dto.optionId)
  }

  /** `GET /scheduling/baseline?plantId=&source=&resourceId=` — live plan vs a baseline arm (D57). */
  @Get('baseline')
  baseline(
    @CurrentUser() user: JwtPayload,
    @Query('plantId') plantId: string,
    @Query('source') source: string,
    @Query('resourceId') resourceId?: string,
  ) {
    const parsed: BaselineSource = baselineSourceSchema.parse(source)
    return this.planComparison.compare(user.tenantId, plantId, parsed, resourceId)
  }
}
