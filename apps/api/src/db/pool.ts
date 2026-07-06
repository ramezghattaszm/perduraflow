import { Global, Module } from '@nestjs/common'
import { Pool } from 'pg'
import { env } from '../config/env'

// NOTE (§4B, D-L1 factor-as-string boundary): we deliberately do NOT register a global `numeric`
// (OID 1700) type-parser. node-postgres returns `numeric` as its native decimal STRING, and we keep
// it a string all the way to the mapper — the value survives digit-for-digit, with no IEEE-double
// rounding anywhere in storage or transport. The single, explicit narrowing to a JS `number` happens
// at the DTO boundary (`MasterDataResolver.getUomFactors`), which is the documented precision cliff;
// making that computation first-class exact-decimal is a logged future item (docs/REMAINING-ITEMS).
// A global parser here would silently re-introduce the rounding for every `numeric` column, so it stays off.

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
