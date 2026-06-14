import { Global, Module } from '@nestjs/common'
import { Pool } from 'pg'
import { env } from '../config/env'

/**
 * The single shared `pg` Pool for the deployable (one database). Per-module
 * Drizzle instances are each scoped to ONLY their own module's tables (api-spec
 * §0 O2) but all draw connections from this one Pool — we isolate the Drizzle
 * *instance*, never the connection. There are no per-module pools.
 */
export const PG_POOL = Symbol('PG_POOL')

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => new Pool({ connectionString: env.DATABASE_URL }),
    },
  ],
  exports: [PG_POOL],
})
export class PoolModule {}
