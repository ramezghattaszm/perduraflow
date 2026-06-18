import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import type { ConversationStatus, ConversationTurnRole, RecordedToolCall } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { schedulingSchema } from './_schema'

/**
 * Conversation (phase 6) — a **persistent, named, auditable** record (D6), not
 * ephemeral chat. ULID id (time-sortable). Tenant-scoped; optionally pinned to a
 * plant (the entity catalog + engine calls). The conversation constructs + explains
 * scenarios; it never commits (apply stays on the board guardrail, D26).
 */
export const conversation = schedulingSchema.table(
  'conversation',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id'),
    name: text('name').notNull(),
    status: text('status').$type<ConversationStatus>().notNull().default('active'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('conversation_tenant_idx').on(t.tenantId) }),
)

/**
 * Conversation turn (phase 6) — one message. ULID id sorts turns chronologically.
 * `grounded_refs` are the stored-result / engine-result ids the turn's facts came
 * from (the non-fabrication audit proof — a scheduling-claim turn with none is a
 * detectable violation). `tool_calls` is the route trace; `result_id` links a Type-2
 * turn to the what-if result it produced. `status` flags a degraded (LLM-failed) turn.
 */
export const conversationTurn = schedulingSchema.table(
  'conversation_turn',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id),
    role: text('role').$type<ConversationTurnRole>().notNull(),
    content: text('content').notNull(),
    groundedRefs: jsonb('grounded_refs').$type<string[]>().notNull().default([]),
    toolCalls: jsonb('tool_calls').$type<RecordedToolCall[]>().notNull().default([]),
    resultId: text('result_id'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    status: text('status').$type<'ok' | 'degraded'>().notNull().default('ok'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ convIdx: index('conversation_turn_conv_idx').on(t.conversationId) }),
)

export type Conversation = typeof conversation.$inferSelect
export type NewConversation = typeof conversation.$inferInsert
export type ConversationTurn = typeof conversationTurn.$inferSelect
export type NewConversationTurn = typeof conversationTurn.$inferInsert
