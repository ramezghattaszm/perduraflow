import { pgSchema } from 'drizzle-orm/pg-core'

/** The `binding` kernel module's Postgres schema namespace (api-spec §0 O2 / §11.1). */
export const bindingSchema = pgSchema('binding')
