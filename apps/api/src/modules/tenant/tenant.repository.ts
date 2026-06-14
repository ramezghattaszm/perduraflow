import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { TENANT_DB, type TenantDatabase } from './tenant.db'
import { tenant, type Tenant } from './schema'

@Injectable()
export class TenantRepository {
  constructor(@Inject(TENANT_DB) private readonly db: TenantDatabase) {}

  findFirstActive(): Promise<Tenant | undefined> {
    return this.db.query.tenant.findFirst({ where: eq(tenant.isActive, true) })
  }

  findById(id: string): Promise<Tenant | undefined> {
    return this.db.query.tenant.findFirst({ where: eq(tenant.id, id) })
  }

  async create(name: string): Promise<Tenant> {
    const [created] = await this.db.insert(tenant).values({ name }).returning()
    return created!
  }
}
