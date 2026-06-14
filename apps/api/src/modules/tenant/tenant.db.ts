import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `tenant` module's Drizzle instance — scoped to ONLY the tenant schema's
 * tables (O2), drawing from the one shared Pool. It has never heard of any other
 * module's tables, so a cross-module join cannot compile.
 */
export const TENANT_DB = Symbol('TENANT_DB')
export type TenantDatabase = ReturnType<typeof drizzle<typeof schema>>

export const tenantDbProvider: Provider = {
  provide: TENANT_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): TenantDatabase => drizzle(pool, { schema }),
}
