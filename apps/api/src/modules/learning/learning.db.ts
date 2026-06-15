import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `learning` module's Drizzle instance — scoped to ONLY the `learning` schema
 * (O2). It cannot reference scheduling/master-data tables; it learns from actuals
 * keyed by text refs and publishes `learning.read`.
 */
export const LEARNING_DB = Symbol('LEARNING_DB')
export type LearningDatabase = ReturnType<typeof drizzle<typeof schema>>

export const learningDbProvider: Provider = {
  provide: LEARNING_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): LearningDatabase => drizzle(pool, { schema }),
}
