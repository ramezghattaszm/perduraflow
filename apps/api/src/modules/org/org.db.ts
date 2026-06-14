import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `org` module's Drizzle instance — scoped to ONLY the org schema's tables
 * (O2), over the one shared Pool. Cannot reference tenant/auth tables.
 */
export const ORG_DB = Symbol('ORG_DB')
export type OrgDatabase = ReturnType<typeof drizzle<typeof schema>>

export const orgDbProvider: Provider = {
  provide: ORG_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): OrgDatabase => drizzle(pool, { schema }),
}
