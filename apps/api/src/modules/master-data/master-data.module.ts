import { Module } from '@nestjs/common'
import { OrgModule } from '../org/org.module'
import { MasterDataAdminController } from './master-data.admin.controller'
import { MasterDataController } from './master-data.controller'
import { masterDataDbProvider } from './master-data.db'
import { MASTERDATA_READ, MasterDataReadService } from './master-data-read.service'
import { MasterDataRepository } from './master-data.repository'
import { MasterDataService } from './master-data.service'

/**
 * Master Data module (phase 1 — the first DOMAIN module). Owns the `master_data`
 * Postgres schema + its scoped Drizzle instance, the admin CRUD surface, and the
 * published `masterdata.read 1.0` contract. Imports OrgModule to CONSUME the
 * kernel `org.read 1.1` contract (plant/calendar validation, O4) — never org's
 * tables. EXPORTS only the read interface (MASTERDATA_READ) so phase-2 scheduling
 * binds to the contract, not the repository (O1). **No binding resolver** (O7).
 */
@Module({
  imports: [OrgModule],
  controllers: [MasterDataController, MasterDataAdminController],
  providers: [
    masterDataDbProvider,
    MasterDataRepository,
    MasterDataService,
    MasterDataReadService,
    { provide: MASTERDATA_READ, useExisting: MasterDataReadService },
  ],
  exports: [MASTERDATA_READ],
})
export class MasterDataModule {}
