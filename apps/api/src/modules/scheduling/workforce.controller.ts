import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { SchedulingService } from './scheduling.service'

/**
 * Workforce coverage (View 3 · D54) — operator×station coverage + readiness + the
 * cert-gap → named-operator OT **confirmed proposal**. Read is authenticated; the
 * proposal confirm is ConfigureGuard-gated (human-disposed, never auto — D54/D43).
 */
@Controller('workforce')
@UseGuards(JwtAuthGuard)
export class WorkforceController {
  constructor(private readonly scheduling: SchedulingService) {}

  /** `GET /workforce/coverage?plantId=` — coverage grid + readiness + cert-gap proposals. */
  @Get('coverage')
  coverage(@CurrentUser() user: JwtPayload, @Query('plantId') plantId: string) {
    return this.scheduling.coverage(user.tenantId, plantId)
  }

  /**
   * `POST /workforce/proposals/:id/confirm` — human-confirm the OT call-in (D54).
   * Stateless ack this phase (the proposal is derived from coverage each load);
   * the confirm is the human disposition the demo shows. ConfigureGuard-gated.
   */
  @Post('proposals/:id/confirm')
  @UseGuards(ConfigureGuard)
  confirm(@Param('id') id: string) {
    return { id, confirmed: true }
  }
}
