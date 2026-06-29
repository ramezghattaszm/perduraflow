import { Module } from '@nestjs/common'
import { ConfigModule } from '../config/config.module'
import { OrgModule } from '../org/org.module'
import { LearningController } from './learning.controller'
import { learningDbProvider } from './learning.db'
import { LEARNING_READ, LearningReadService } from './learning-read.service'
import { LearningRepository } from './learning.repository'
import { LearningService } from './learning.service'

/**
 * Learning module (phase 3 — the platform ML-parameter-learning capability, A14).
 * Owns the `learning` Postgres schema + scoped Drizzle instance, ingests execution
 * actuals off the EventBus (the closed loop, D5), runs the **damped** rule, and
 * publishes `learning.read 1.0`. EXPORTS only the read interface (LEARNING_READ) so
 * scheduling consumes the contract, not the repository (O1). Consumes nothing from
 * scheduling at compile time — actuals arrive as events (decoupled). Reads the kernel
 * `org.read` (calendar) + master-data (via the global BindingResolver) to project the wear
 * crossing in WORKING time through the SAME calendar the scheduler honors (one calendar).
 */
@Module({
  imports: [ConfigModule, OrgModule],
  controllers: [LearningController],
  providers: [
    learningDbProvider,
    LearningRepository,
    LearningReadService,
    LearningService,
    { provide: LEARNING_READ, useExisting: LearningReadService },
  ],
  exports: [LEARNING_READ],
})
export class LearningModule {}
