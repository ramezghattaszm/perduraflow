import { type Provider } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { PG_POOL } from '../../db/pool'
import * as schema from './schema'

/**
 * The `auth` module's Drizzle instance — scoped to ONLY the auth schema's tables
 * (user, role, approval_tier, otp_code) over the one shared Pool (O2). It cannot
 * reference org or tenant tables; auth reaches org only via the `org.read`
 * contract and tenant via TenantService.
 */
export const AUTH_DB = Symbol('AUTH_DB')
export type AuthDatabase = ReturnType<typeof drizzle<typeof schema>>

export const authDbProvider: Provider = {
  provide: AUTH_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): AuthDatabase => drizzle(pool, { schema }),
}
