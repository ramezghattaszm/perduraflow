import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE, type Database } from '../db/drizzle.module'
import { tenant } from '../db/schema'

export const DEFAULT_TENANT_NAME = 'Default'

/**
 * Resolves which tenant a user belongs to. The template default is single-tenant:
 * everyone is assigned to the one seeded default tenant.
 *
 * EXTENSION POINT — to make the app multi-tenant, replace `resolveTenantId` with
 * your mapping (e.g. look up a tenant by the email's domain, an invite code, or a
 * subdomain) and throw TENANT_NOT_FOUND when no tenant matches. The rest of the
 * app already scopes every query by the resulting tenantId, so nothing else
 * changes.
 */
@Injectable()
export class TenantService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Resolves the tenant id for an email (single-tenant: the default tenant,
   * created lazily if the seed has not run). See EXTENSION POINT above.
   */
  async resolveTenantId(_email: string): Promise<string> {
    const [row] = await this.db
      .select({ id: tenant.id })
      .from(tenant)
      .where(eq(tenant.isActive, true))
      .limit(1)
    if (row) return row.id

    // Seed not yet run — create the default tenant lazily so the app is usable.
    const [created] = await this.db.insert(tenant).values({ name: DEFAULT_TENANT_NAME }).returning()
    return created!.id
  }
}
