import { Module, type Provider } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerModule } from '@nestjs/throttler'
import {
  ASSET_READ_CONTRACT,
  type AssetReadContract,
  BOM_READ_CONTRACT,
  type BomReadContract,
  MASTERDATA_READ_CONTRACT,
  type MasterDataReadContract,
  REFERENCE_READ_CONTRACT,
  type ReferenceReadContract,
} from '@perduraflow/contracts'
import { PoolModule } from './db/pool'
import { AuthModule } from './modules/auth/auth.module'
import { BindingModule } from './modules/binding/binding.module'
import { BindingResolver } from './modules/binding/binding.resolver'
import { ConfigModule as AppConfigModule } from './modules/config/config.module'
import { buildAssetTypeReferenceSet, registerReferenceSet } from './modules/config/config.refsets'
import { EmailModule } from './modules/email/email.module'
import { EventBusModule } from './modules/eventbus/eventbus.module'
import { HealthModule } from './modules/health/health.module'
import { LearningModule } from './modules/learning/learning.module'
import { MasterDataModule } from './modules/master-data/master-data.module'
import { LlmModule } from './modules/llm/llm.module'
import { MASTERDATA_READ } from './modules/master-data/master-data-read.service'
import { BOM_READ } from './modules/master-data/bom-read.service'
import { ASSET_READ } from './modules/master-data/asset-read.service'
import { REFERENCE_READ } from './modules/config/reference-read.service'
import { NotifierModule } from './modules/notifier/notifier.module'
import { OrgModule } from './modules/org/org.module'
import { SchedulingModule } from './modules/scheduling/scheduling.module'
import { TenantModule } from './modules/tenant/tenant.module'

/**
 * Composition-root registration of contract counterparts (A2 / api-spec §11.1):
 * the binding resolver learns which implementation fulfils a domain contract for
 * a given mode. Phase 2 registers exactly one — `masterdata.read` →
 * `platform_module` → the Master Data module's read service. Done here (not in
 * the `binding` module) so `binding` imports no domain module. Eager factory.
 *
 * It ALSO registers config's real reference sets (D-L2-7): the `asset_type` set's
 * in-use probe is Master Data data (any active `tooling_asset` of the type), so it
 * is wired here through the same O7 binding — config → `asset.read` → the probe —
 * keeping config from importing Master Data. Descriptor + probe register together.
 */
const BINDING_COUNTERPARTS: Provider = {
  provide: 'BINDING_COUNTERPARTS_BOOTSTRAP',
  inject: [BindingResolver, MASTERDATA_READ, REFERENCE_READ, BOM_READ, ASSET_READ],
  useFactory: (
    resolver: BindingResolver,
    masterData: MasterDataReadContract,
    referenceData: ReferenceReadContract,
    bomData: BomReadContract,
    assetData: AssetReadContract,
  ) => {
    resolver.register(MASTERDATA_READ_CONTRACT.id, 'platform_module', masterData)
    resolver.register(REFERENCE_READ_CONTRACT.id, 'platform_module', referenceData)
    resolver.register(BOM_READ_CONTRACT.id, 'platform_module', bomData)
    resolver.register(ASSET_READ_CONTRACT.id, 'platform_module', assetData)
    // asset_type: descriptor + in-use probe together. The probe resolves asset.read per tenant through the
    // binding (config never imports Master Data) — config → Master Data callback for suppression safety.
    registerReferenceSet(
      buildAssetTypeReferenceSet(async (tenantId, memberKey) =>
        (await resolver.resolve<AssetReadContract>(tenantId, ASSET_READ_CONTRACT)).hasActiveToolingAssetOfType(tenantId, memberKey),
      ),
    )
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
    HealthModule,
    BindingModule,
    EmailModule,
    NotifierModule,
    LlmModule,
    TenantModule,
    OrgModule,
    AuthModule,
    MasterDataModule,
    AppConfigModule,
    LearningModule,
    SchedulingModule,
  ],
  providers: [BINDING_COUNTERPARTS],
})
export class AppModule {}
