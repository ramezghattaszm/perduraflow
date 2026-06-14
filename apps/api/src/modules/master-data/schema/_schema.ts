import { pgSchema } from 'drizzle-orm/pg-core'

/** The `master-data` module's Postgres schema namespace (api-spec §0 O2 / §10). */
export const masterDataSchema = pgSchema('master_data')
