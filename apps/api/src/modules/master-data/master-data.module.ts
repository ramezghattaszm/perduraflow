import { Module } from '@nestjs/common'
import { OrgModule } from '../org/org.module'
import { MasterDataAdminController } from './master-data.admin.controller'
import { MasterDataController } from './master-data.controller'
import { masterDataDbProvider } from './master-data.db'
import { MASTERDATA_READ, MasterDataReadService } from './master-data-read.service'
import { MasterDataRepository } from './master-data.repository'
import { MasterDataResolver } from './master-data.resolver'
import { MasterDataService } from './master-data.service'

/**
 * Master Data module (the first DOMAIN module). Owns the `master_data` Postgres schema +
 * its scoped Drizzle instance, the admin CRUD surface, the resolve-as-of/revise service
 * ({@link MasterDataResolver}, Layer 0), and the published `masterdata.read` contract
 * (currently `1.4`). Imports OrgModule to CONSUME the kernel `org.read 1.1` contract
 * (plant/calendar validation, O4) — never org's tables. EXPORTS only the read interface
 * (MASTERDATA_READ); scheduling binds to the contract through the global `BindingResolver`
 * (O7 — registered as the `platform_module` counterpart at the composition root), never the
 * repository (O1).
 */
@Module({
  imports: [OrgModule],
  controllers: [MasterDataController, MasterDataAdminController],
  providers: [
    masterDataDbProvider,
    MasterDataRepository,
    MasterDataResolver,
    MasterDataService,
    MasterDataReadService,
    { provide: MASTERDATA_READ, useExisting: MasterDataReadService },
  ],
  exports: [MASTERDATA_READ],
})
export class MasterDataModule {}
