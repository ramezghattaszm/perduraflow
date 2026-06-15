import { pgSchema } from 'drizzle-orm/pg-core'

/** The `learning` module's Postgres schema namespace (api-spec §0 O2 / §12). */
export const learningSchema = pgSchema('learning')
