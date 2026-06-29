import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'

/** Liveness probe module — see {@link HealthController}. No providers; no dependencies. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
