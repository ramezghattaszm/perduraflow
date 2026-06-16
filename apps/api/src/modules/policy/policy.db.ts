import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `policy` module's Drizzle instance — scoped to ONLY the `policy` schema (O2).
 * Holds the per-tenant autonomy config; publishes `policy.read` for the learning gate.
 */
export const POLICY_DB = Symbol('POLICY_DB')
export type PolicyDatabase = ReturnType<typeof drizzle<typeof schema>>

export const policyDbProvider: Provider = {
  provide: POLICY_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): PolicyDatabase => drizzle(pool, { schema }),
}
