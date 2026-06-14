import { Module } from '@nestjs/common'
import { tenantDbProvider } from './tenant.db'
import { TenantRepository } from './tenant.repository'
import { TenantService } from './tenant.service'

/**
 * Tenant module (kernel). Owns the `tenant` Postgres schema and its scoped
 * Drizzle instance; exposes TenantService for tenant resolution/validation.
 */
@Module({
  providers: [tenantDbProvider, TenantRepository, TenantService],
  exports: [TenantService],
})
export class TenantModule {}
