import { pgSchema } from 'drizzle-orm/pg-core'

/** The `scheduling` module's Postgres schema namespace (api-spec §0 O2 / §11). */
export const schedulingSchema = pgSchema('scheduling')
