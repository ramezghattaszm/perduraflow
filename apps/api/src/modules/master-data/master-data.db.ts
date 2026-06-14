import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `master-data` module's Drizzle instance — scoped to ONLY the `master_data`
 * schema's tables (O2), over the one shared Pool. It cannot reference org/auth/
 * tenant tables; cross-module reads go through `org.read` (O1/O4).
 */
export const MASTERDATA_DB = Symbol('MASTERDATA_DB')
export type MasterDataDatabase = ReturnType<typeof drizzle<typeof schema>>

export const masterDataDbProvider: Provider = {
  provide: MASTERDATA_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): MasterDataDatabase => drizzle(pool, { schema }),
}
