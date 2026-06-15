import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { SchedulingService } from './scheduling.service'

/**
 * Authenticated read routes for scheduling (`GET /scheduling/*`). Tenant-scoped
 * from the JWT. The board consumes these; writes (solve/commit) live on the admin
 * controller behind ConfigureGuard.
 */
@Controller('scheduling')
@UseGuards(JwtAuthGuard)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

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
}
