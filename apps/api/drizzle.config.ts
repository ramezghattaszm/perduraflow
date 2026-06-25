import type { Config } from 'drizzle-kit'

/**
 * Migration generator config. This is the ONE place that legitimately aggregates
 * every module's schema (api-spec §0 O3 exemption) — it points at each module's
 * own `schema/index.ts` so drizzle-kit emits `CREATE SCHEMA` per Postgres
 * namespace and the per-module tables. Runtime/import isolation is enforced
 * elsewhere (scoped Drizzle instances + the boundary lint rule); the generator
 * is exempt by design.
 */
export default {
  schema: [
    './src/modules/tenant/schema/index.ts',
    './src/modules/auth/schema/index.ts',
    './src/modules/org/schema/index.ts',
    './src/modules/master-data/schema/index.ts',
    './src/modules/binding/schema/index.ts',
    './src/modules/scheduling/schema/index.ts',
    './src/modules/learning/schema/index.ts',
    './src/modules/policy/schema/index.ts',
    './src/modules/config/schema/index.ts',
  ],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/perduraflow',
  },
} satisfies Config
