import { doublePrecision, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { learningSchema } from './_schema'

/**
 * Execution actual (§4.3) — **append-only** immutable history (D5 replay / D57
 * measured baseline read this tail). No soft-delete, never updated. Cross-module
 * refs (`*_id`) are text → master-data / scheduling, validated through contracts;
 * **no cross-schema FK** (O2). `seq` is the deterministic emission order so the
 * windowed learning rule is order-stable (D2).
 */
export const executionActual = learningSchema.table(
  'execution_actual',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    actualEventId: text('actual_event_id').notNull(),
    scheduleVersionId: text('schedule_version_id').notNull(),
    scheduledOperationId: text('scheduled_operation_id').notNull(),
    resourceId: text('resource_id').notNull(),
    routingOperationId: text('routing_operation_id').notNull(),
    // ALLOWLISTED version-id holder (Layer 0 D-L0-6) — a FROZEN SNAPSHOT of the exact part version
    // that RAN, never resolved-as-live. Kept as a version id (like `supersedes_id`); migrating it
    // would falsify which spec a historical actual was recorded against.
    partId: text('part_id').notNull(),
    actualStart: timestamp('actual_start', { withTimezone: true }).notNull(),
    actualEnd: timestamp('actual_end', { withTimezone: true }).notNull(),
    actualSetupTime: doublePrecision('actual_setup_time'),
    actualCycleTime: doublePrecision('actual_cycle_time'),
    stdSetupTime: doublePrecision('std_setup_time').notNull().default(0),
    stdCycleTime: doublePrecision('std_cycle_time').notNull().default(0),
    goodQty: doublePrecision('good_qty').notNull(),
    scrapQty: doublePrecision('scrap_qty').notNull().default(0),
    downtimeMinutes: doublePrecision('downtime_minutes').notNull().default(0),
    downtimeReason: text('downtime_reason'),
    source: text('source').$type<'simulator' | 'manual'>().notNull().default('simulator'),
    seq: integer('seq').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('execution_actual_tenant_idx').on(t.tenantId),
    versionIdx: index('execution_actual_version_idx').on(t.scheduleVersionId),
    opIdx: index('execution_actual_op_idx').on(t.resourceId, t.routingOperationId),
  }),
)

export type ExecutionActual = typeof executionActual.$inferSelect
export type NewExecutionActual = typeof executionActual.$inferInsert
