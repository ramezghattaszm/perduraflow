import { Global, Module } from '@nestjs/common'
import { Pool, types } from 'pg'
import { env } from '../config/env'

// Return Postgres `numeric` (OID 1700) as a JS `number`, not the node-postgres default `string`.
// The one `numeric` column is `uom_conversion.factor` (§4B) — a conversion factor the app treats as a
// number; exact-decimal STORAGE is the point (vs binary-float `double precision`), and its magnitudes
// round-trip losslessly through an IEEE double. Register once at module load (global to the pg driver).
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value))

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
