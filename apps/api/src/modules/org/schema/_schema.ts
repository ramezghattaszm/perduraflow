import { pgSchema } from 'drizzle-orm/pg-core'

/** The `org` module's Postgres schema namespace (api-spec §0 O2). */
export const orgSchema = pgSchema('org')
