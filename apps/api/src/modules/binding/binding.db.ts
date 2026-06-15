import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `binding` module's Drizzle instance — scoped to ONLY the `binding` schema
 * (O2), over the one shared Pool.
 */
export const BINDING_DB = Symbol('BINDING_DB')
export type BindingDatabase = ReturnType<typeof drizzle<typeof schema>>

export const bindingDbProvider: Provider = {
  provide: BINDING_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): BindingDatabase => drizzle(pool, { schema }),
}
