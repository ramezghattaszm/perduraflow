import { Injectable } from '@nestjs/common'
import { TenantRepository } from './tenant.repository'

export const DEFAULT_TENANT_NAME = 'Default'

/**
 * Tenancy (kernel). Resolves which tenant a user belongs to and validates tenant
 * references for other kernel modules. The template default is single-tenant:
 * everyone is assigned to the one seeded default tenant (SKIP-01).
 *
 * EXTENSION POINT — for multi-tenant, replace `resolveTenantId` with the real
 * mapping (email domain, invite code, subdomain) and throw TENANT_NOT_FOUND when
 * none matches. Every other query already scopes by the resulting tenantId.
 */
@Injectable()
export class TenantService {
  constructor(private readonly repo: TenantRepository) {}

  /**
   * Resolves the tenant id for an email (single-tenant: the default tenant,
   * created lazily if the seed has not run). See EXTENSION POINT above.
   */
  async resolveTenantId(_email: string): Promise<string> {
    const existing = await this.repo.findFirstActive()
    if (existing) return existing.id
    const created = await this.repo.create(DEFAULT_TENANT_NAME)
    return created.id
  }

  /** True if the tenant id exists (kernel read used to validate scope refs). */
  async exists(tenantId: string): Promise<boolean> {
    return Boolean(await this.repo.findById(tenantId))
  }
}
