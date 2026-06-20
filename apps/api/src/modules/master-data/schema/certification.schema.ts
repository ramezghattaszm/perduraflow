import { boolean, doublePrecision, index, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Certification taxonomy (MD15) — the canonical reference behind the scheduler's
 * certification-grain constraint (D54). Externally sourced; canonical view only
 * (mappings live in the integration layer). `code` is unique within the tenant.
 */
export const certification = masterDataSchema.table(
  'certification',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('certification_tenant_idx').on(t.tenantId),
    codeUnique: unique('certification_tenant_code_unique').on(t.tenantId, t.code),
  }),
)

/**
 * Operator (MD15) — minimal externally-sourced stub. Master Data does **not**
 * roster operators (SKIP-14); it holds the reference identity + home plant + an
 * optional labor rate (D57). `home_plant_id` → kernel org via `org.read` (O4).
 */
export const operator = masterDataSchema.table(
  'operator',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    homePlantId: text('home_plant_id').notNull(),
    laborRate: doublePrecision('labor_rate'),
    // Performance / efficiency rating (C5) — "percent of standard" (IE/time-study convention):
    // 1.0 = standard, >1.0 faster, <1.0 slower. Stored as a ratio (0.5), displayed as a percent
    // (50%). The scheduler applies it to RUN time only: effectiveCycle = baseCycle / performanceFactor.
    // It DELIBERATELY DIVIDES (the inverse of a cycle multiplier) so "higher = better" holds —
    // 0.9 → cycle/0.9 (slower), 1.1 → faster. Do NOT introduce an inversion. Setup is not divided.
    performanceFactor: doublePrecision('performance_factor').notNull().default(1.0),
    // Next-shift presence for the workforce coverage view (seeded/D35; phase 3).
    // `false` = OUT this shift (distinct from `is_active` soft-delete).
    available: boolean('available').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('operator_tenant_idx').on(t.tenantId) }),
)

/** Operator × certification qualification (MD15). Intra-schema FKs only (O2). */
export const operatorQualification = masterDataSchema.table(
  'operator_qualification',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    operatorId: text('operator_id')
      .notNull()
      .references(() => operator.id),
    certificationId: text('certification_id')
      .notNull()
      .references(() => certification.id),
  },
  (t) => ({
    operatorIdx: index('operator_qualification_operator_idx').on(t.operatorId),
    pairUnique: unique('operator_qualification_pair_unique').on(t.operatorId, t.certificationId),
  }),
)

export type Certification = typeof certification.$inferSelect
export type NewCertification = typeof certification.$inferInsert
export type Operator = typeof operator.$inferSelect
export type NewOperator = typeof operator.$inferInsert
export type OperatorQualification = typeof operatorQualification.$inferSelect
export type NewOperatorQualification = typeof operatorQualification.$inferInsert
