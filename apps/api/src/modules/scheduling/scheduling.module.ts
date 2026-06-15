import { Module } from '@nestjs/common'
import { OrgModule } from '../org/org.module'
import { SchedulingAdminController } from './scheduling.admin.controller'
import { SchedulingController } from './scheduling.controller'
import { schedulingDbProvider } from './scheduling.db'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService } from './scheduling.service'

/**
 * Scheduling module (phase 2 — second domain module). Owns the `scheduling`
 * schema + scoped Drizzle instance. Consumes **master-data through the global
 * `BindingResolver`** (O7 — never imports MasterDataModule) and the kernel
 * `org.read` directly (imports OrgModule). The `BindingModule` is `@Global`, so
 * the resolver is injectable without importing it here.
 */
@Module({
  imports: [OrgModule],
  controllers: [SchedulingController, SchedulingAdminController],
  providers: [schedulingDbProvider, SchedulingRepository, SchedulingService],
})
export class SchedulingModule {}
