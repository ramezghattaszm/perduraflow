import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `scheduling` module's Drizzle instance — scoped to ONLY the `scheduling`
 * schema (O2). It cannot reference master-data/org tables; master-data is read
 * through the binding-resolved `masterdata.read` contract, org through `org.read`.
 */
export const SCHEDULING_DB = Symbol('SCHEDULING_DB')
export type SchedulingDatabase = ReturnType<typeof drizzle<typeof schema>>

export const schedulingDbProvider: Provider = {
  provide: SCHEDULING_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): SchedulingDatabase => drizzle(pool, { schema }),
}
