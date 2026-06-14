import { pgSchema } from 'drizzle-orm/pg-core'

/** The `tenant` module's Postgres schema namespace (api-spec §0 O2). */
export const tenantSchema = pgSchema('tenant')
