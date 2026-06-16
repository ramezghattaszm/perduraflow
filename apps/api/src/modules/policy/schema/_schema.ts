import { pgSchema } from 'drizzle-orm/pg-core'

/** The `policy` module's Postgres schema namespace (api-spec §0 O2 / §13.5). */
export const policySchema = pgSchema('policy')
