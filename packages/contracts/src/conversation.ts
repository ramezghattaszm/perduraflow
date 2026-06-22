import { z } from 'zod'

/**
 * Conversation contract (phase 6 — the conversational layer). A planner converses
 * with the system: **Type-1** questions answered from the stored deterministic
 * what-if artifact (retrieve + analyze, no engine call), **Type-2** questions that
 * construct a change-set and call the real what-if engine, and an honest
 * **out-of-scope** decline. The LLM reasons about language + what to retrieve/compute
 * — never about what the scheduling answer is (A19 extends to conversation).
 *
 * Conversations are **persistent, named, auditable** records (D6), not ephemeral
 * chat: ULID ids (time-sortable), a human name, and per-turn provenance — the
 * `groundedRefs` (which stored/engine result ids a turn grounded in — the
 * non-fabrication proof), the tool calls (the route trace), and model/promptVersion.
 */

export const conversationStatusSchema = z.enum(['active', 'archived'])
export type ConversationStatus = z.infer<typeof conversationStatusSchema>

export type ConversationTurnRole = 'user' | 'assistant'

/** A conversation header. */
export interface ConversationDto {
  id: string
  /** The plant the conversation is scoped to (entity catalog + engine calls). */
  plantId: string | null
  /** Human-referenceable name (auto-generated from the first turn, user-editable). */
  name: string
  status: ConversationStatus
  createdAt: string
}

/** A tool the assistant invoked on a turn — the recorded route trace (audit). */
export interface RecordedToolCall {
  name: string
  input: Record<string, unknown>
}

/**
 * One conversation turn. `groundedRefs` are the stored-result / engine-result ids
 * this turn's facts came from — **a turn that asserts scheduling facts must carry
 * at least one** (an empty set on a grounded claim is a detectable non-fabrication
 * violation). `resultId` links a Type-2 turn to the what-if result it produced
 * (so the UI shows the option-set + Apply through the existing guardrail).
 */
export interface ConversationTurnDto {
  id: string
  conversationId: string
  role: ConversationTurnRole
  content: string
  groundedRefs: string[]
  toolCalls: RecordedToolCall[]
  /** A new what-if result this turn produced (Type-2); null otherwise. */
  resultId: string | null
  model: string | null
  promptVersion: string | null
  /** `ok`, or `degraded` when the LLM failed and the turn fell back to a safe response. */
  status: 'ok' | 'degraded'
  createdAt: string
}

/** A conversation + its ordered turns (oldest first, by ULID). */
export interface ConversationDetailDto {
  conversation: ConversationDto
  turns: ConversationTurnDto[]
}

/**
 * What the planner is looking at when they send a turn (Pass B). A per-turn snapshot used to
 * resolve **deictic/unspecified** references ("this", "here", "the current option") against the
 * on-screen selection — a DEFAULT, never a filter: a named entity always overrides it, and any
 * order/resource stays reachable by name regardless of screen. Optional; absent → Pass A behavior.
 */
export const screenContextSchema = z
  .object({
    /** The screen the planner is on, e.g. 'board'. */
    screen: z.string().min(1).max(40),
    /** Screen sub-view, e.g. board 'day' | 'week'. */
    view: z.string().max(40).optional(),
    versionId: z.string().optional(),
    /** Selected order (board: the selected bar's demand line) — the deictic default for "this order". */
    selectedOrderId: z.string().optional(),
    /** Selected resource/lane — the deictic default for "this line". */
    selectedResourceId: z.string().optional(),
    /** Selected operator (workforce) — the deictic default for "this operator / this gap". */
    selectedOperatorId: z.string().optional(),
    /** The what-if result on screen — binds "this option / why not X" to the displayed analysis. */
    activeResultId: z.string().optional(),
  })
  .strict()
export type ScreenContext = z.infer<typeof screenContextSchema>

// --- request schemas ---------------------------------------------------------

/** `POST /scheduling/conversations` — start a conversation with a first message. */
export const createConversationSchema = z
  .object({ plantId: z.string().min(1), message: z.string().min(1).max(2000), screenContext: screenContextSchema.optional() })
  .strict()
export type CreateConversationRequest = z.infer<typeof createConversationSchema>

/** `POST /scheduling/conversations/:id/turns` — add a user turn (response streamed). */
export const addTurnSchema = z.object({ message: z.string().min(1).max(2000), screenContext: screenContextSchema.optional() }).strict()
export type AddTurnRequest = z.infer<typeof addTurnSchema>

/** `PATCH /scheduling/conversations/:id` — rename. */
export const renameConversationSchema = z.object({ name: z.string().min(1).max(120) }).strict()
export type RenameConversationRequest = z.infer<typeof renameConversationSchema>
