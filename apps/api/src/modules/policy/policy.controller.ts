import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { autonomyConfigUpdateSchema, type AutonomyConfigUpdate } from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { PolicyService } from './policy.service'

/**
 * Objective-Policy autonomy controls (View 5 — api-spec §13.7). `GET` is any
 * authenticated user (the ops leader views the threshold); `PUT` is ConfigureGuard
 * (the autonomy boundary is config — D42, audited).
 */
@Controller('policy')
@UseGuards(JwtAuthGuard)
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  /** `GET /policy/autonomy` — the tenant's configured thresholds (or safe defaults). */
  @Get('autonomy')
  getAutonomy(@CurrentUser() user: JwtPayload) {
    return this.policy.getAutonomyConfig(user.tenantId)
  }

  /** `PUT /policy/autonomy` — set the confidence threshold + tier modes (ConfigureGuard). */
  @Put('autonomy')
  @UseGuards(ConfigureGuard)
  setAutonomy(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(autonomyConfigUpdateSchema)) body: AutonomyConfigUpdate,
  ) {
    return this.policy.updateAutonomyConfig(user.tenantId, body)
  }
}
