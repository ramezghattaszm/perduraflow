import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `config` module's Drizzle instance — scoped to ONLY the `config` schema (O2).
 * Holds the hierarchical config overrides + audit log for the framework.
 */
export const CONFIG_DB = Symbol('CONFIG_DB')
export type ConfigDatabase = ReturnType<typeof drizzle<typeof schema>>

export const configDbProvider: Provider = {
  provide: CONFIG_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): ConfigDatabase => drizzle(pool, { schema }),
}
