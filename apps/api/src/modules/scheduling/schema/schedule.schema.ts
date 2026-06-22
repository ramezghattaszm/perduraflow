import { boolean, doublePrecision, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import type {
  BindingKind,
  OptimizerRunStatus,
  OptimizerTrigger,
  ScheduleVersionStatus,
  TimeSource,
} from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { schedulingSchema } from './_schema'

/**
 * Optimizer run (§4.9) — one execution of the sequencer (the SKIP-03 heuristic
 * stand-in this phase). `stop_reason` records why it ended (deterministic
 * termination, A16). `plant_id` → kernel `org` (text).
 */
export const optimizerRun = schedulingSchema.table(
  'optimizer_run',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    trigger: text('trigger').$type<OptimizerTrigger>().notNull().default('manual'),
    objectiveSummary: text('objective_summary').notNull(),
    status: text('status').$type<OptimizerRunStatus>().notNull(),
    stopReason: text('stop_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    inputDemandCount: integer('input_demand_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('optimizer_run_tenant_idx').on(t.tenantId) }),
)

/**
 * Schedule version (§4.9) — a versioned schedule snapshot; never edited in place
 * (D6). `solve` → `draft`; commit → `committed` + supersede prior (AS11).
 * Intra-schema FKs only (O2).
 */
export const scheduleVersion = schedulingSchema.table(
  'schedule_version',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    status: text('status').$type<ScheduleVersionStatus>().notNull().default('draft'),
    horizonStart: timestamp('horizon_start', { withTimezone: true }).notNull(),
    horizonEnd: timestamp('horizon_end', { withTimezone: true }).notNull(),
    optimizerRunId: text('optimizer_run_id')
      .notNull()
      .references(() => optimizerRun.id),
    supersedesVersionId: text('supersedes_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('schedule_version_tenant_idx').on(t.tenantId),
    plantIdx: index('schedule_version_plant_idx').on(t.plantId),
  }),
)

/**
 * Scheduled operation (§4.4, committed-schedule line). `part_id`/
 * `routing_operation_id`/`resource_id` → master-data (text, resolved via the
 * bound `masterdata.read`; **no cross-schema FK** — proof #2). `setup_source`/
 * `cycle_source` default `standard`; `*_confidence` null — wired now, flipped by
 * Phase 3's closed loop with zero change (SKIP-04). Intra-schema FK to the version.
 */
export const scheduledOperation = schedulingSchema.table(
  'scheduled_operation',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    scheduleVersionId: text('schedule_version_id')
      .notNull()
      .references(() => scheduleVersion.id),
    demandLineId: text('demand_line_id').notNull(),
    partId: text('part_id').notNull(),
    routingOperationId: text('routing_operation_id').notNull(),
    resourceId: text('resource_id').notNull(),
    opSeq: integer('op_seq').notNull(),
    sequencePosition: integer('sequence_position').notNull(),
    plannedStart: timestamp('planned_start', { withTimezone: true }).notNull(),
    plannedEnd: timestamp('planned_end', { withTimezone: true }).notNull(),
    plannedQty: doublePrecision('planned_qty').notNull(),
    setupTime: doublePrecision('setup_time').notNull(),
    cycleTime: doublePrecision('cycle_time').notNull(),
    setupSource: text('setup_source').$type<TimeSource>().notNull().default('standard'),
    cycleSource: text('cycle_source').$type<TimeSource>().notNull().default('standard'),
    setupConfidence: doublePrecision('setup_confidence'),
    cycleConfidence: doublePrecision('cycle_confidence'),
    atRisk: boolean('at_risk').notNull().default(false),
    atRiskReason: text('at_risk_reason'),
    // Causal-chain attribution (D-late): the floor component that set this op's start, and — when it
    // was a blocking op (resource contention / routing precedence) — that blocker's (line, opSeq).
    // Recorded by the deterministic sequencer so a late order traces to a root with zero re-derivation.
    bindingKind: text('binding_kind').$type<BindingKind>(),
    bindingBlockerDemandLineId: text('binding_blocker_demand_line_id'),
    bindingBlockerOpSeq: integer('binding_blocker_op_seq'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ versionIdx: index('scheduled_operation_version_idx').on(t.scheduleVersionId) }),
)

export type OptimizerRun = typeof optimizerRun.$inferSelect
export type NewOptimizerRun = typeof optimizerRun.$inferInsert
export type ScheduleVersion = typeof scheduleVersion.$inferSelect
export type NewScheduleVersion = typeof scheduleVersion.$inferInsert
export type ScheduledOperation = typeof scheduledOperation.$inferSelect
export type NewScheduledOperation = typeof scheduledOperation.$inferInsert
