import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import {
  changeSetSchema,
  type ConversationDetailDto,
  type ConversationDto,
  type ConversationTurnDto,
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
const EVALUATE_TOOL: LlmTool = {
  name: 'evaluate_what_if',
  description:
    'Run the deterministic scheduling engine on a NEW scenario expressed as a change-set. Use when the question asks about a change not in the stored analysis (delay an order, add overtime, take a line down, change a quantity). Compound changes allowed.',
  parameters: {
    type: 'object',
    properties: {
      changeSet: {
        type: 'object',
        properties: {
          origin: { type: 'object', properties: { type: { type: 'string', enum: ['demand', 'prediction', 'collision', 'manual'] }, ref: { type: 'string' } }, required: ['type'] },
          changes: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              description:
                "One change. kind ∈ demand_qty{demandLineId,to:int} | demand_date{demandLineId,to:ISO} | resource_window{resourceId,downFrom:ISO,downTo:ISO} | overtime{resourceId,hours} | wear_remediation{resourceId,action:'service'|'defer'|'ot'}",
            },
          },
        },
        required: ['origin', 'changes'],
      },
    },
    required: ['changeSet'],
  },
}

/** Scheduling keywords/figures that mark a turn as making a *scheduling claim*. */
const CLAIM_RX = /\d|otif|oee|changeover|displacement|overtime|cost\/unit|late order|option|reroute|defer/i

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
  async create(tenantId: string, plantId: string, message: string, userId: string | null): Promise<ConversationDetailDto> {
    const conv = await this.repo.createConversation({ tenantId, plantId, name: nameFrom(message), createdBy: userId })
    await this.processTurn(tenantId, conv, message, userId)
    return this.get(tenantId, conv.id)
  }

  /** Add a user turn to an existing conversation; returns the assistant turn. */
  async addTurn(tenantId: string, conversationId: string, message: string, userId: string | null): Promise<ConversationTurnDto> {
    const conv = await this.requireConversation(tenantId, conversationId)
    return this.processTurn(tenantId, conv, message, userId)
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
  private async processTurn(tenantId: string, conv: Conversation, message: string, userId: string | null): Promise<ConversationTurnDto> {
    await this.repo.createTurn({ tenantId, conversationId: conv.id, role: 'user', content: message })
    const prior = await this.repo.listTurns(conv.id) // includes the user turn just added (history)
    const plantId = conv.plantId ?? ''

    // The Type-1 context: the most recent result this conversation produced, else the
    // plant's latest stored result. Mutated when a Type-2 evaluation produces a new one.
    let activeResultId =
      [...prior].reverse().find((t) => t.resultId)?.resultId ?? (plantId ? (await this.repo.findLatestWhatIfResult(tenantId, plantId))?.id : undefined) ?? null

    const catalog = plantId ? await this.scheduling.entityCatalog(tenantId, plantId) : { orders: [], resources: [] }
    const system = buildSystemPrompt(catalog)
    const messages = prior.map((t) => ({ role: t.role, content: t.content }))

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
          return { content: JSON.stringify(compactArtifact(res.id, res.recommendedOptionId, res.baseKpis, res.options)), groundedRefs: [res.id], resultId: res.id }
        } catch (e) {
          const code = e instanceof AppException ? e.code : 'error'
          return { content: `The engine could not evaluate that change (${code}). Ask the planner to clarify or decline.`, isError: true }
        }
      }
      return { content: 'Unknown tool.', isError: true }
    }

    try {
      const loop = await this.gateway.runToolLoop({ system, messages, tools: [RETRIEVE_TOOL, EVALUATE_TOOL] }, dispatch)
      let content = loop.text || 'I could not produce a response.'
      let status: 'ok' | 'degraded' = 'ok'
      // Detectable non-fabrication violation: a scheduling claim with no grounding/tool call.
      if (loop.groundedRefs.length === 0 && loop.toolCalls.length === 0 && CLAIM_RX.test(content)) {
        this.logger.warn(`grounding violation in conversation ${conv.id}: scheduling claim without groundedRefs`)
        content = 'I can only answer from the computed analysis and I do not have a grounded result for that — ask about the current options, or describe a scenario to evaluate.'
        status = 'degraded'
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
function compactArtifact(id: string, recommendedOptionId: string | null, baseKpis: unknown, options: WhatIfOption[]) {
  const labelOf = (optId: string) => optionLabelEn(options.find((o) => o.id === optId)?.labelKey ?? optId)
  return {
    resultId: id,
    recommendedOption: recommendedOptionId ? labelOf(recommendedOptionId) : null,
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

/** The ground-never-fabricate + routing system prompt, with the plant entity catalog inlined. */
function buildSystemPrompt(catalog: { orders: unknown[]; resources: unknown[] }): string {
  return [
    'You are a scheduling copilot for a production planner. You answer ONLY using tools; you NEVER state a scheduling number or result from your own reasoning.',
    '',
    'Tools:',
    '- retrieve_what_if: the stored, already-computed analysis. Use it for ANY question about the existing options/factors/constraints/costs. No new computation.',
    '- evaluate_what_if: runs the deterministic engine on a NEW scenario you express as a change-set. Use it for a change not in the stored analysis.',
    '',
    'Routing:',
    '- A question about the existing analysis → call retrieve_what_if, then answer from what it returns.',
    '- A new scenario → construct a change-set and call evaluate_what_if, then explain the engine result.',
    '- If retrieve_what_if returns nothing relevant → construct a what-if or say you do not have that. NEVER estimate.',
    '- Off-domain or unanswerable (not this plant’s scheduling) → say you cannot help. Do NOT call a tool. Do NOT fabricate.',
    '',
    'Change-set construction — map names to ids using ONLY these plant entities:',
    `ORDERS: ${JSON.stringify(catalog.orders)}`,
    `LINES: ${JSON.stringify(catalog.resources)}`,
    'A change-set is { origin:{type}, changes:[ … ] }. If a request cannot map to the change kinds, say you cannot evaluate it. Ask one clarifying question only if genuinely ambiguous.',
    '',
    'Grounding: every scheduling fact must come from a tool result; keep numbers exactly as returned. Be concise, like a planner’s note. You explain and construct — you never apply or commit.',
    'Language: write natural prose. Refer to options, factors, and constraints by their human labels exactly as given in the tool result (e.g. "Protect delivery", "displacement", "firm delivery") — NEVER print a raw identifier, snake_case key, or code token, and never add a "(see …)" reference.',
  ].join('\n')
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
