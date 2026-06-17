import { Module } from '@nestjs/common'
import { LearningModule } from '../learning/learning.module'
import { OrgModule } from '../org/org.module'
import { DevController } from './dev.controller'
import { NarrationService } from './narration.service'
import { PlanComparisonService } from './plan-comparison.service'
import { SchedulingAdminController } from './scheduling.admin.controller'
import { SchedulingController } from './scheduling.controller'
import { schedulingDbProvider } from './scheduling.db'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService } from './scheduling.service'
import { SimulatorService } from './simulator.service'
import { WhatIfService } from './whatif.service'
import { WorkforceController } from './workforce.controller'

/**
 * Scheduling module (phase 2 → 3). Owns the `scheduling` schema + scoped Drizzle
 * instance. Consumes **master-data through the global `BindingResolver`** (O7) and
 * the kernel `org.read` directly (OrgModule). Phase 3: consumes `learning.read`
 * directly (LearningModule — A14 platform capability), hosts the demo **simulator**
 * fixture (emits actuals on the EventBus; learning consumes them), and serves the
 * variance/scorecard/workforce reads. The `BindingModule`/`EventBus` are `@Global`.
 */
@Module({
  imports: [OrgModule, LearningModule],
  controllers: [SchedulingController, SchedulingAdminController, WorkforceController, DevController],
  providers: [
    schedulingDbProvider,
    SchedulingRepository,
    SchedulingService,
    SimulatorService,
    WhatIfService,
    PlanComparisonService,
    NarrationService,
  ],
})
export class SchedulingModule {}
