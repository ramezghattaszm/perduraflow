import { pgSchema } from 'drizzle-orm/pg-core'

/** The `config` module's Postgres schema namespace (O2) — the hierarchical config framework. */
export const configSchema = pgSchema('config')
