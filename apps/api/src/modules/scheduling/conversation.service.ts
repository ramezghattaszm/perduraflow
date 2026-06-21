import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import {
  changeSetSchema,
  type ConversationDetailDto,
  type ConversationDto,
  type ConversationTurnDto,
  type RequestedChange,
  type ScreenContext,
  type WhatIfOption,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { LlmGateway, type ToolDispatch } from '../llm/llm.gateway'
import type { LlmTool, LlmToolCall } from '../llm/llm.canonical'
import type { Conversation, ConversationTurn } from './schema'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService } from './scheduling.service'
import { factorLabelEn, optionLabelEn } from './whatif.narration'
import { WhatIfService } from './whatif.service'

/** The two tools the LLM routes among (the route IS the tool choice). */
const RETRIEVE_TOOL: LlmTool = {
  name: 'retrieve_what_if',
  description:
    'Return the stored, already-computed what-if analysis for this conversation (options with factors+contributions, constraints, comparatives, costed KPIs). Use for ANY question about the existing analysis. No new computation.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}
/**
 * One change, as a **discriminated union by `kind`** (conversation Pass A, #3). Each branch
 * enforces exactly its required fields (`additionalProperties:false`), so the model fills the
 * right shape per kind instead of free-forming — mis-shapes (e.g. `orderId` vs `demandLineId`,
 * a missing `downFrom/downTo`) drop out, which cuts validation-retry loop turns and makes
 * COMPOUND change-sets shape correctly item-by-item. The Zod `changeSetSchema` remains the hard
 * server-side enforcer; this schema is the strong model-facing hint (tolerated as nested `oneOf`
 * by the anthropic/openai adapters; the default `recorded` provider never reaches this tool).
 */
const CHANGE_ITEM_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['demand_qty'] }, demandLineId: { type: 'string' }, to: { type: 'integer', description: 'new required quantity' } }, required: ['kind', 'demandLineId', 'to'] },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['demand_date'] }, demandLineId: { type: 'string' }, to: { type: 'string', description: 'new required date, ISO 8601' } }, required: ['kind', 'demandLineId', 'to'] },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['resource_window'] }, resourceId: { type: 'string' }, downFrom: { type: 'string', description: 'ISO 8601' }, downTo: { type: 'string', description: 'ISO 8601' } }, required: ['kind', 'resourceId', 'downFrom', 'downTo'] },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['overtime'] }, resourceId: { type: 'string' }, hours: { type: 'number', description: 'overtime hours to add on this resource' } }, required: ['kind', 'resourceId', 'hours'] },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['wear_remediation'] }, resourceId: { type: 'string' }, action: { type: 'string', enum: ['service', 'defer', 'ot'] } }, required: ['kind', 'resourceId', 'action'] },
  ],
}
const EVALUATE_TOOL: LlmTool = {
  name: 'evaluate_what_if',
  description:
    'Run the deterministic scheduling engine on a NEW scenario expressed as a change-set. Use when the question asks about a change not in the stored analysis (delay an order, add overtime, take a line down, change a quantity). Compound changes allowed — include one item per change; every requested change is reported back as applied / partial / unapplied.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      changeSet: {
        type: 'object',
        additionalProperties: false,
        properties: {
          origin: { type: 'object', additionalProperties: false, properties: { type: { type: 'string', enum: ['demand', 'prediction', 'collision', 'manual'] }, ref: { type: 'string' } }, required: ['type'] },
          changes: { type: 'array', minItems: 1, items: CHANGE_ITEM_SCHEMA },
        },
        required: ['origin', 'changes'],
      },
    },
    required: ['changeSet'],
  },
}

/**
 * Order lookup + disambiguation (conversation Pass A, #2). The inline catalog is a near-horizon
 * SLICE (token + accuracy cost of inlining the whole order book grows with the plant); this tool
 * resolves any order outside the slice — or confirms which order an ambiguous reference means —
 * over the FULL set. The dispatch returns the match count so the model can ask rather than guess.
 */
const FIND_ORDERS_TOOL: LlmTool = {
  name: 'find_orders',
  description:
    'Look up demand orders by any reference — order id (demandLineId), release reference, customer, or part — when the order is not in the inline ORDERS list, or to confirm which order an ambiguous reference means. Returns matching orders with their ids and the match count. If more than one matches, ASK the planner which one; never guess.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { query: { type: 'string', description: 'order id, release reference, customer, or part — case-insensitive' } },
    required: ['query'],
  },
}
/**
 * Inline only the nearest-due slice of orders in the prompt; the rest resolve via find_orders.
 * Sized so the demo's full near-term order spine sits inline (no unexpected lookup in the scripted
 * flow) while still capping prompt growth as the order book extends past the near horizon.
 */
const ORDER_SLICE_CAP = 24
const FIND_ORDERS_LIMIT = 12

/** Scheduling keywords/figures that mark a turn as making a *scheduling claim*. */
const CLAIM_RX = /\d|otif|oee|changeover|displacement|overtime|cost\/unit|late order|option|reroute|defer/i

/** A demand order in the entity catalog (the conversation's resolution surface). */
type CatalogOrder = { demandLineId: string; releaseReference: string | null; customer: string; part: string; qty: number; firmness: string; due: string }

/**
 * Conversational layer (phase 6) — language + orchestration over phase-5's engine,
 * **no new engine**. Routes each turn by **tool choice** inside the gateway tool-loop:
 * `retrieve_what_if` (Type-1, read the stored artifact), `evaluate_what_if` (Type-2,
 * construct a change-set → the real what-if engine), or no tool → honest decline. The
 * LLM never produces a scheduling answer from its own reasoning: Type-1 reads stored
 * computed values; Type-2 calls the engine. Every grounded claim records `groundedRefs`;
 * an ungrounded scheduling claim is a **detected violation** (logged + degraded).
 * Persistent + auditable (D6). Constructs + explains only — never commits (D26).
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger('Conversation')
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly scheduling: SchedulingService,
    private readonly whatIf: WhatIfService,
    private readonly gateway: LlmGateway,
  ) {}

  /** Start a conversation (auto-named) and process the first turn. */
  async create(tenantId: string, plantId: string, message: string, userId: string | null, screenContext?: ScreenContext): Promise<ConversationDetailDto> {
    const conv = await this.repo.createConversation({ tenantId, plantId, name: nameFrom(message), createdBy: userId })
    await this.processTurn(tenantId, conv, message, userId, screenContext)
    return this.get(tenantId, conv.id)
  }

  /** Add a user turn to an existing conversation; returns the assistant turn. */
  async addTurn(tenantId: string, conversationId: string, message: string, userId: string | null, screenContext?: ScreenContext): Promise<ConversationTurnDto> {
    const conv = await this.requireConversation(tenantId, conversationId)
    return this.processTurn(tenantId, conv, message, userId, screenContext)
  }

  /** The conversation + its ordered turns. @throws CONVERSATION_NOT_FOUND */
  async get(tenantId: string, id: string): Promise<ConversationDetailDto> {
    const conv = await this.requireConversation(tenantId, id)
    const turns = await this.repo.listTurns(conv.id)
    return { conversation: toConversationDto(conv), turns: turns.map(toTurnDto) }
  }

  /** The tenant's conversations, newest first (tenant-isolated). */
  async list(tenantId: string): Promise<ConversationDto[]> {
    return (await this.repo.listConversations(tenantId)).map(toConversationDto)
  }

  /** @throws CONVERSATION_NOT_FOUND */
  async rename(tenantId: string, id: string, name: string): Promise<ConversationDto> {
    const row = await this.repo.renameConversation(tenantId, id, name)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Conversation not found', ERROR_CODES.CONVERSATION_NOT_FOUND)
    return toConversationDto(row)
  }

  // --- the turn engine -------------------------------------------------------
  private async processTurn(tenantId: string, conv: Conversation, message: string, userId: string | null, screenContext?: ScreenContext): Promise<ConversationTurnDto> {
    await this.repo.createTurn({ tenantId, conversationId: conv.id, role: 'user', content: message })
    const prior = await this.repo.listTurns(conv.id) // includes the user turn just added (history)
    const plantId = conv.plantId ?? ''

    // The Type-1 context (Pass B precedence): the what-if result ON SCREEN wins, so "explain this
    // option" binds to the displayed analysis; else the most recent result this conversation
    // produced; else the plant's latest. Mutated when a Type-2 evaluation produces a new one.
    let activeResultId =
      screenContext?.activeResultId ??
      [...prior].reverse().find((t) => t.resultId)?.resultId ??
      (plantId ? (await this.repo.findLatestWhatIfResult(tenantId, plantId))?.id : undefined) ??
      null

    const catalog = plantId ? await this.scheduling.entityCatalog(tenantId, plantId) : { orders: [], resources: [] }
    // Inline only the nearest-due slice (catalog is already due-sorted); find_orders covers the rest.
    const orderSlice = catalog.orders.slice(0, ORDER_SLICE_CAP)
    const screenLine = renderScreenContext(screenContext, catalog)
    const system = buildSystemPrompt(orderSlice, catalog.resources, catalog.orders.length, screenLine)
    const messages = prior.map((t) => ({ role: t.role, content: t.content }))

    // The structure-derived change-set echo for a Type-2 turn — captured from the engine's ledger
    // (never LLM free-text) and prepended to the answer so the planner always sees exactly what
    // was applied / not applied (the never-silently-drop guarantee, conversation Pass A).
    let lastLedger: RequestedChange[] | null = null

    const dispatch: ToolDispatch = async (call: LlmToolCall) => {
      if (call.name === 'retrieve_what_if') {
        const r = activeResultId ? await this.repo.findWhatIfResult(tenantId, activeResultId) : undefined
        if (!r) return { content: 'No stored what-if analysis exists for this plant yet — describe a scenario to evaluate, or say you cannot answer.', groundedRefs: [] }
        return { content: JSON.stringify(compactArtifact(r.id, r.recommendedOptionId, r.baseKpis, r.options as WhatIfOption[])), groundedRefs: [r.id] }
      }
      if (call.name === 'evaluate_what_if') {
        const parsed = changeSetSchema.safeParse((call.input as { changeSet?: unknown }).changeSet)
        if (!parsed.success) return { content: `Invalid change-set: ${parsed.error.issues.map((i) => i.message).join('; ')}`, isError: true }
        try {
          const res = await this.whatIf.evaluate(tenantId, plantId, parsed.data, undefined, userId)
          activeResultId = res.id
          lastLedger = res.requestedChanges
          return { content: JSON.stringify(compactArtifact(res.id, res.recommendedOptionId, res.baseKpis, res.options, res.requestedChanges)), groundedRefs: [res.id], resultId: res.id }
        } catch (e) {
          const code = e instanceof AppException ? e.code : 'error'
          return { content: `The engine could not evaluate that change (${code}). Ask the planner to clarify or decline.`, isError: true }
        }
      }
      if (call.name === 'find_orders') {
        const q = String((call.input as { query?: unknown }).query ?? '').toLowerCase().trim()
        const matches = q
          ? catalog.orders.filter(
              (o: CatalogOrder) =>
                o.demandLineId.toLowerCase().includes(q) ||
                (o.releaseReference ?? '').toLowerCase().includes(q) ||
                o.customer.toLowerCase().includes(q) ||
                o.part.toLowerCase().includes(q),
            )
          : []
        const note =
          matches.length === 0
            ? 'No order matches — ask the planner to clarify; do not guess or evaluate.'
            : matches.length === 1
              ? 'Exactly one match — safe to use its demandLineId.'
              : 'Multiple orders match — ASK the planner which one (name the customer/part/due); never guess.'
        return { content: JSON.stringify({ matchCount: matches.length, orders: matches.slice(0, FIND_ORDERS_LIMIT), note }), groundedRefs: [] }
      }
      return { content: 'Unknown tool.', isError: true }
    }

    try {
      const loop = await this.gateway.runToolLoop({ system, messages, tools: [RETRIEVE_TOOL, EVALUATE_TOOL, FIND_ORDERS_TOOL] }, dispatch)
      let content = loop.text || 'I could not produce a response.'
      let status: 'ok' | 'degraded' = 'ok'
      // Detectable non-fabrication violation: a scheduling claim with no grounding/tool call.
      if (loop.groundedRefs.length === 0 && loop.toolCalls.length === 0 && CLAIM_RX.test(content)) {
        this.logger.warn(`grounding violation in conversation ${conv.id}: scheduling claim without groundedRefs`)
        content = 'I can only answer from the computed analysis and I do not have a grounded result for that — ask about the current options, or describe a scenario to evaluate.'
        status = 'degraded'
      }
      // Never silently drop: a Type-2 turn always leads with the structure-derived echo of what
      // the engine actually applied (and what it couldn't), independent of the model's prose.
      if (lastLedger) {
        const echo = renderChangeEcho(lastLedger)
        if (echo) content = `${echo}\n\n${content}`
      }
      const turn = await this.repo.createTurn({
        tenantId,
        conversationId: conv.id,
        role: 'assistant',
        content,
        groundedRefs: loop.groundedRefs,
        toolCalls: loop.toolCalls.map((c) => ({ name: c.name, input: c.input })),
        resultId: loop.resultIds[0] ?? activeResultId,
        model: loop.model,
        promptVersion: loop.promptVersion,
        status,
      })
      return toTurnDto(turn)
    } catch (e) {
      // Graceful degradation (§3): a provider/loop failure never breaks the surface.
      this.logger.warn(`conversation turn failed (${conv.id}): ${(e as Error).message}`)
      const turn = await this.repo.createTurn({
        tenantId,
        conversationId: conv.id,
        role: 'assistant',
        content: 'I could not process that just now — the analysis and options are still available alongside.',
        groundedRefs: [],
        toolCalls: [],
        resultId: activeResultId,
        status: 'degraded',
      })
      return toTurnDto(turn)
    }
  }

  private async requireConversation(tenantId: string, id: string): Promise<Conversation> {
    const conv = await this.repo.findConversation(tenantId, id)
    if (!conv) throw new AppException(HttpStatus.NOT_FOUND, 'Conversation not found', ERROR_CODES.CONVERSATION_NOT_FOUND)
    return conv
  }
}

/** Human label for a constraint key — so the LLM never echoes the raw key. */
const CONSTRAINT_LABEL: Record<string, string> = {
  feasibility: 'feasibility',
  firm_delivery: 'firm delivery',
  changeover_grouping: 'changeover grouping',
}

/**
 * Compact, LLM-readable view of a stored what-if result (the Type-1 substrate). Every
 * field is **human-readable** — options/factors/constraints/comparatives carry natural
 * labels, never internal ids/keys (`protect_delivery`, `displacement`, `firm_delivery`),
 * so the model's prose reads naturally and can't leak an identifier.
 */
function compactArtifact(id: string, recommendedOptionId: string | null, baseKpis: unknown, options: WhatIfOption[], requestedChanges?: RequestedChange[]) {
  const labelOf = (optId: string) => optionLabelEn(options.find((o) => o.id === optId)?.labelKey ?? optId)
  return {
    resultId: id,
    recommendedOption: recommendedOptionId ? labelOf(recommendedOptionId) : null,
    // What the engine actually did with each requested change (Type-2 only) — so the model's prose
    // can speak to anything not fully applied. The planner-facing echo is rendered separately.
    requestedChanges: requestedChanges?.map((c) => ({ change: c.summary, status: c.status, note: c.note })),
    baseKpis,
    options: options.map((o) => ({
      option: optionLabelEn(o.labelKey),
      rank: o.rank,
      feasible: o.feasible,
      infeasibleReason: o.infeasibleReasonKey ? 'no feasible schedule for this change' : null,
      score: o.score,
      kpis: o.kpis,
      factors: o.rationale.factors.map((f) => ({ factor: factorLabelEn(f.key), value: f.rawValue, unit: f.unit, contribution: f.contribution, direction: f.direction })),
      constraints: o.rationale.constraints.map((c) => ({ constraint: CONSTRAINT_LABEL[c.key] ?? c.key, binding: c.binding, slack: c.slack })),
      comparatives: o.rationale.comparatives.map((c) => ({
        versus: labelOf(c.vsOptionId),
        verdict: c.verdict,
        decidingFactors: c.decidingFactors.map((d) => ({ factor: factorLabelEn(d.key), delta: d.delta })),
      })),
    })),
  }
}

/**
 * The CURRENT SCREEN line (Pass B) — a planner-readable snapshot of what's on screen, with the
 * selected order rendered by its human release reference and the selected line by name. Returns
 * null when there's no screen context (→ pure Pass A behavior). Used only to resolve deictic refs.
 */
export function renderScreenContext(sc: ScreenContext | undefined, catalog: { orders: CatalogOrder[]; resources: { id: string; name: string }[] }): string | null {
  if (!sc) return null
  const orderRef = (id: string): string => {
    const o = catalog.orders.find((x) => x.demandLineId === id)
    return o?.releaseReference ? `${o.demandLineId} (${o.releaseReference})` : id
  }
  const resName = (id: string): string => catalog.resources.find((x) => x.id === id)?.name ?? id
  // Per-screen natural phrasing of the deictic referent (Pass C).
  if (sc.screen === 'scorecard') {
    const arm = sc.view === 'measured_historical' ? 'measured-historical' : 'engine-lift'
    const scope = sc.selectedResourceId ? `scope ${resName(sc.selectedResourceId)}` : 'scope the whole plant'
    return `the scorecard — the ${arm} comparison, ${scope}`
  }
  if (sc.screen === 'exception') {
    return sc.selectedOrderId ? `the exception queue — at-risk order ${orderRef(sc.selectedOrderId)} selected` : 'the exception queue (no order selected)'
  }
  // Board (and any other screen) — the generic selection rendering.
  const parts: string[] = [`screen ${sc.screen}${sc.view ? ` (${sc.view} view)` : ''}`]
  if (sc.selectedOrderId) parts.push(`selected order ${orderRef(sc.selectedOrderId)}`)
  if (sc.selectedResourceId) parts.push(`selected line ${resName(sc.selectedResourceId)}`)
  if (sc.activeResultId) parts.push('a what-if analysis is open on screen')
  return parts.join(', ')
}

/** The ground-never-fabricate + routing system prompt, with a near-horizon entity slice inlined. */
export function buildSystemPrompt(orderSlice: CatalogOrder[], resources: unknown[], totalOrders: number, screenLine: string | null): string {
  const screenBlock = screenLine
    ? [
        '',
        `CURRENT SCREEN: the planner is viewing ${screenLine}.`,
        'Use the current screen ONLY to resolve a DEICTIC or unspecified reference — "this", "it", "here", "this order", "this line", "the current option". Resolve such a reference to the matching on-screen selection (and "this option / why not X" to the analysis open on screen).',
        'A NAMED entity ALWAYS WINS: if the planner names an order or line (by id, release reference, customer, or part), resolve THAT via the inline list / find_orders and IGNORE the on-screen selection — even when a different order is selected. Screen context is a default for deictic references, never a filter on what you can reach.',
        'If a deictic reference has NO matching on-screen selection (e.g. "this order" but no order is selected), ASK which one — do NOT fall back to anything or guess.',
        'Capability boundary: you can run what-if scenarios on ORDERS (evaluate_what_if) and read the stored what-if analysis. You do NOT yet have tools to retrieve baseline/comparison or workforce-coverage figures. If the planner asks to explain or act on those (e.g. "explain this lift", "this comparison", a coverage gap), resolve WHAT they refer to from the current screen, then say plainly you can work with orders and what-if scenarios but cannot pull baseline/coverage detail yet — never invent those numbers.',
      ]
    : []
  return [
    'You are a scheduling copilot for a production planner. You answer ONLY using tools; you NEVER state a scheduling number or result from your own reasoning.',
    '',
    'Tools:',
    '- retrieve_what_if: the stored, already-computed analysis. Use it for ANY question about the existing options/factors/constraints/costs. No new computation.',
    '- evaluate_what_if: runs the deterministic engine on a NEW scenario you express as a change-set. Use it for a change not in the stored analysis.',
    '- find_orders: look up a demand order (by id, release reference, customer, or part) not in the inline list below, or to confirm which order an ambiguous reference means.',
    '',
    'Routing:',
    '- A question about the existing analysis → call retrieve_what_if, then answer from what it returns.',
    '- A new scenario → construct a change-set and call evaluate_what_if, then explain the engine result.',
    '- If retrieve_what_if returns nothing relevant → construct a what-if or say you do not have that. NEVER estimate.',
    '- Off-domain or unanswerable (not this plant’s scheduling) → say you cannot help. Do NOT call a tool. Do NOT fabricate.',
    '',
    'Change-set construction — map names to ids using these plant entities. Each order has a demandLineId (internal id), a releaseReference (the id the planner reads off the board, e.g. GM-830-1142), customer, part, qty, and due date.',
    `ORDERS (nearest ${orderSlice.length} of ${totalOrders} by due date): ${JSON.stringify(orderSlice)}`,
    `LINES: ${JSON.stringify(resources)}`,
    'Resolution: match a reference to an order by demandLineId OR releaseReference OR customer/part. If the order is NOT in the list above, call find_orders. DISAMBIGUATION: if a reference matches more than one order (in the list or via find_orders), ASK the planner which one — name the distinguishing customer/part/due. Never guess an id, and never call evaluate_what_if on a guessed order.',
    ...screenBlock,
    'A change-set is { origin:{type}, changes:[ … ] }. If a request cannot map to the change kinds, say you cannot evaluate it.',
    '',
    'Faithfulness: evaluate_what_if returns `requestedChanges` — what the engine did with EACH change you asked for (applied / partial / unapplied, with a note). A plain-language summary of these is shown to the planner automatically, so do NOT repeat the list verbatim. But you MUST NOT imply a change took effect if its status is partial or unapplied — explain the consequence (e.g. "the overtime could not be added because that resource has no overtime allowance"). Never present a half-applied scenario as fully done.',
    'Grounding: every scheduling fact must come from a tool result; keep numbers exactly as returned. Be concise, like a planner’s note. You explain and construct — you never apply or commit.',
    'Language: write natural prose. Refer to options, factors, and constraints by their human labels exactly as given in the tool result (e.g. "Protect delivery", "displacement", "firm delivery") — NEVER print a raw identifier, snake_case key, or code token, and never add a "(see …)" reference.',
  ].join('\n')
}

/**
 * Render the structure-derived change-set echo (conversation Pass A) from the engine's ledger —
 * deterministic, never LLM prose. Leads a Type-2 answer so the planner sees exactly what was
 * applied (with any clamp) and what could not be, making a dropped/limited clause impossible to
 * miss. `partial` rows show the adjustment note inline; `unapplied` rows are called out separately.
 */
export function renderChangeEcho(ledger: RequestedChange[]): string {
  if (ledger.length === 0) return ''
  const applied = ledger
    .filter((c) => c.status === 'applied' || c.status === 'partial')
    .map((c) => (c.note ? `${c.summary} (${c.note})` : c.summary))
  const unapplied = ledger.filter((c) => c.status === 'unapplied')
  const lines: string[] = []
  if (applied.length > 0) lines.push(`**Applied:** ${applied.join('; ')}.`)
  if (unapplied.length > 0) lines.push(`**Not applied:** ${unapplied.map((c) => `${c.summary} — ${c.note}`).join('; ')}.`)
  return lines.join('\n')
}

/** Conversation name from the first message — trimmed, recorded-safe, user-editable. */
function nameFrom(message: string): string {
  const t = message.trim().replace(/\s+/g, ' ')
  return t.length <= 60 ? t : `${t.slice(0, 57)}…`
}

function toConversationDto(c: Conversation): ConversationDto {
  return { id: c.id, plantId: c.plantId, name: c.name, status: c.status, createdAt: c.createdAt.toISOString() }
}
function toTurnDto(t: ConversationTurn): ConversationTurnDto {
  return {
    id: t.id,
    conversationId: t.conversationId,
    role: t.role,
    content: t.content,
    groundedRefs: t.groundedRefs,
    toolCalls: t.toolCalls,
    resultId: t.resultId,
    model: t.model,
    promptVersion: t.promptVersion,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  }
}
