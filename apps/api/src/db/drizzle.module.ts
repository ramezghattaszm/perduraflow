import { Global, Module } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import * as schema from './schema'

export const DRIZZLE = Symbol('DRIZZLE')
export type Database = ReturnType<typeof drizzle<typeof schema>>

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): Database => {
        const pool = new Pool({ connectionString: env.DATABASE_URL })
        return drizzle(pool, { schema })
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
