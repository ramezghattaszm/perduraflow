import { Module } from '@nestjs/common'
import { OrgAdminController } from './org.admin.controller'
import { OrgController } from './org.controller'
import { orgDbProvider } from './org.db'
import { ORG_READ, OrgReadService } from './org-read.service'
import { OrgRepository } from './org.repository'
import { OrgService } from './org.service'

/**
 * Org module (kernel). Owns the `org` Postgres schema + its scoped Drizzle
 * instance, the admin CRUD surface, and the kernel `org.read` contract. It
 * EXPORTS only the read interface (ORG_READ → OrgReadService) so other modules
 * (e.g. auth validating role scope refs, O4) consume org through the contract,
 * never its repository or tables.
 */
@Module({
  controllers: [OrgController, OrgAdminController],
  providers: [
    orgDbProvider,
    OrgRepository,
    OrgService,
    OrgReadService,
    { provide: ORG_READ, useExisting: OrgReadService },
  ],
  exports: [ORG_READ],
})
export class OrgModule {}
