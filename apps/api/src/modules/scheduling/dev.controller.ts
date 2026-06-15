import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { simulateActualsSchema, type SimulateActualsRequest } from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { SimulatorService } from './simulator.service'

/**
 * **Demo/dev-only** surface (SKIP-51) — the execution-actuals simulator + drift
 * trigger. Clearly separated from the operational/admin API and **never in nav**.
 * Staging scaffolding for the closed-loop demo; the loop it drives is the real
 * mechanism. Authenticated (tenant-scoped) but not part of the product surface.
 */
@Controller('dev/scheduling')
@UseGuards(JwtAuthGuard)
export class DevController {
  constructor(private readonly simulator: SimulatorService) {}

  /** `POST /dev/scheduling/simulate` — emit seeded actuals (+ optional drift) for a committed version. */
  @Post('simulate')
  simulate(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(simulateActualsSchema)) dto: SimulateActualsRequest,
  ) {
    return this.simulator.simulate(user.tenantId, dto)
  }
}
