import { pgSchema } from 'drizzle-orm/pg-core'

/** The `auth` module's Postgres schema namespace (api-spec §0 O2). */
export const authSchema = pgSchema('auth')
