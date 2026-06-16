import { Module, type Provider } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerModule } from '@nestjs/throttler'
import { MASTERDATA_READ_CONTRACT, type MasterDataReadContract } from '@perduraflow/contracts'
import { PoolModule } from './db/pool'
import { AuthModule } from './modules/auth/auth.module'
import { BindingModule } from './modules/binding/binding.module'
import { BindingResolver } from './modules/binding/binding.resolver'
import { EmailModule } from './modules/email/email.module'
import { EventBusModule } from './modules/eventbus/eventbus.module'
import { LearningModule } from './modules/learning/learning.module'
import { MasterDataModule } from './modules/master-data/master-data.module'
import { MASTERDATA_READ } from './modules/master-data/master-data-read.service'
import { NotifierModule } from './modules/notifier/notifier.module'
import { OrgModule } from './modules/org/org.module'
import { PolicyModule } from './modules/policy/policy.module'
import { SchedulingModule } from './modules/scheduling/scheduling.module'
import { TenantModule } from './modules/tenant/tenant.module'

/**
 * Composition-root registration of contract counterparts (A2 / api-spec §11.1):
 * the binding resolver learns which implementation fulfils a domain contract for
 * a given mode. Phase 2 registers exactly one — `masterdata.read` →
 * `platform_module` → the Master Data module's read service. Done here (not in
 * the `binding` module) so `binding` imports no domain module. Eager factory.
 */
const BINDING_COUNTERPARTS: Provider = {
  provide: 'BINDING_COUNTERPARTS_BOOTSTRAP',
  inject: [BindingResolver, MASTERDATA_READ],
  useFactory: (resolver: BindingResolver, masterData: MasterDataReadContract) => {
    resolver.register(MASTERDATA_READ_CONTRACT.id, 'platform_module', masterData)
    return true
  },
}

/**
 * Root module — PerduraFlow (kernel spine + org model + domain modules).
 *
 * PoolModule (one shared Pool), EventBusModule, and BindingModule are global.
 * Each module owns a Postgres schema with a scoped Drizzle instance and interacts
 * only through contracts/services (api-spec §0). Scheduling consumes Master Data
 * through the binding resolver (O7), never the module directly.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20, verboseMemoryLeak: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PoolModule,
    EventBusModule,
    BindingModule,
    EmailModule,
    NotifierModule,
    TenantModule,
    OrgModule,
    AuthModule,
    MasterDataModule,
    PolicyModule,
    LearningModule,
    SchedulingModule,
  ],
  providers: [BINDING_COUNTERPARTS],
})
export class AppModule {}
