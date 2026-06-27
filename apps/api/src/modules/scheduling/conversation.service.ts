import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import {
  changeSetSchema,
  type BaselineSource,
  type Change,
  type ChangeSet,
  type CostedKpis,
  type ConversationDetailDto,
  type ConversationDto,
  type ConversationTurnDto,
  type LatenessChainDto,
  type PlanComparisonDto,
  type RequestedChange,
  type ScreenContext,
  type WhatIfOption,
  type WhatIfUnremediable,
  type WorkforceCoverageDto,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
// Value imports (NOT `import type`): these are NestJS DI providers — type-only erases the runtime
// class reference the injector resolves against, so the container can't construct ConversationService.
import { LlmGateway, type ToolDispatch } from '../llm/llm.gateway'
import type { LlmTool, LlmToolCall } from '../llm/llm.canonical'
import type { Conversation, ConversationTurn } from './schema'
import { PlanComparisonService } from './plan-comparison.service'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService } from './scheduling.service'
import { factorLabelEn, optionLabelEn } from './whatif.narration'
import { applySelectability, WhatIfService, type GoalSeekResult } from './whatif.service'

/** The two tools the LLM routes among (the route IS the tool choice). */
const RETRIEVE_TOOL: LlmTool = {
  name: 'retrieve_what_if',
  description:
    'Return the stored, already-computed what-if analysis for this conversation (options with factors+contributions, constraints, comparatives, costed KPIs). Use for ANY question about the existing analysis. No new computation.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}
/**
 * Side-by-side comparison (decide-support #2). Same data as retrieve_what_if, but its presence in
 * the turn's toolCalls is the CLIENT SIGNAL to render a structured options × KPIs table (rendered
 * from the artifact, never the model's figures — render-don't-retype). Narrate the trade-off only.
 */
const COMPARE_OPTIONS_TOOL: LlmTool = {
  name: 'compare_options',
  description:
    "Show a SIDE-BY-SIDE comparison of the current what-if options (a structured options × KPIs table is rendered to the planner automatically). Use when asked to compare options / 'side by side' / which is better across the board. Then NARRATE the trade-off in words — do NOT retype the per-option figures (the table shows them).",
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
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['demand_qty'] },
        demandLineId: { type: 'string' },
        to: { type: 'integer', description: 'new required quantity' },
      },
      required: ['kind', 'demandLineId', 'to'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['demand_date'] },
        demandLineId: { type: 'string' },
        to: { type: 'string', description: 'new required date, ISO 8601' },
      },
      required: ['kind', 'demandLineId', 'to'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['resource_window'] },
        resourceId: { type: 'string' },
        downFrom: { type: 'string', description: 'ISO 8601' },
        downTo: { type: 'string', description: 'ISO 8601' },
      },
      required: ['kind', 'resourceId', 'downFrom', 'downTo'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['overtime'] },
        resourceId: { type: 'string' },
        hours: { type: 'number', description: 'overtime hours to add on this resource' },
      },
      required: ['kind', 'resourceId', 'hours'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['wear_remediation'] },
        resourceId: { type: 'string' },
        action: { type: 'string', enum: ['service', 'defer', 'ot'] },
      },
      required: ['kind', 'resourceId', 'action'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['at_risk_remediation'] },
        demandLineId: { type: 'string', description: 'the firm at-risk order to remediate (standing lateness, no injected disruption)' },
      },
      required: ['kind', 'demandLineId'],
    },
  ],
}
const EVALUATE_TOOL: LlmTool = {
  name: 'evaluate_what_if',
  description:
    "Run the deterministic scheduling engine on a NEW scenario expressed as a change-set. Use when the question asks about a change not in the stored analysis (delay an order, add overtime, take a line down, change a quantity). To REMEDIATE a STANDING firm at-risk order (one late in the committed plan with no injected disruption — 'how do I fix / what are my options for order X'), use the at_risk_remediation change with that order's demandLineId: the engine matches the levers to the order's lateness ROOT — reroute + overtime when it's reroutable capacity contention on a line with an alternative; assign-a-faster-operator + overtime + reroute when it's running below standard because of a SLOW OPERATOR (the operator root); and otherwise only the base levers (so each lever is offered only when it genuinely helps — never reroute for a material wait or a due-before-start order). Do NOT treat an operator-rooted at-risk order as a tool-wear/prediction problem just because its line also shows a wear forecast — remediate the ORDER's root. Compound changes allowed — include one item per change; every requested change is reported back as applied / partial / unapplied.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      changeSet: {
        type: 'object',
        additionalProperties: false,
        properties: {
          origin: {
            type: 'object',
            additionalProperties: false,
            description: 'Optional — defaults to {type:"manual"} (a planner-initiated change). Only set it for a model-driven prediction/collision/demand scenario.',
            properties: {
              type: { type: 'string', enum: ['demand', 'prediction', 'collision', 'manual'] },
              ref: { type: 'string' },
            },
            required: ['type'],
          },
          changes: { type: 'array', minItems: 1, items: CHANGE_ITEM_SCHEMA },
        },
        required: ['changes'],
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
    properties: {
      query: {
        type: 'string',
        description: 'order id, release reference, customer, or part — case-insensitive',
      },
    },
    required: ['query'],
  },
}
/**
 * Baseline retrieval (content-grounding, Pass D) — the live plan vs a baseline arm, the SAME
 * comparison the scorecard shows (calls PlanComparisonService.compare, so the Copilot and the
 * screen can never disagree). Type-1: retrieve + translate, no computation, no action. `arm`/`scope`
 * default to the scorecard's published screen context; a named arm/line overrides (named-wins).
 */
const RETRIEVE_BASELINE_TOOL: LlmTool = {
  name: 'retrieve_baseline',
  description:
    'Return the live plan vs a baseline comparison — the SAME numbers the scorecard shows (per-KPI live / baseline / delta for OTIF, cost/unit, OEE, late orders, throughput). Use for any question about the baseline, "the lift", "vs baseline", or a KPI delta. No computation — explain the returned numbers. Omit arm/scope to use what is on screen.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Nullable (some models emit explicit null for omitted optionals; the dispatch falls back).
      arm: {
        type: ['string', 'null'],
        enum: ['engine_lift', 'historical', null],
        description:
          "which baseline: 'engine_lift' (vs the engine with its intelligence off) or 'historical' (vs recorded outcomes)",
      },
      scope: {
        type: ['string', 'null'],
        description: 'a resource/line id to scope to; omit for the whole plant',
      },
    },
  },
}

/**
 * Coverage retrieval (content-grounding, Pass D) — the workforce coverage the Workforce screen
 * shows (calls SchedulingService.coverage, so the Copilot and screen can never disagree). Type-1:
 * retrieve + translate. A gap is **advisory** (certs are soft — an observation that the plant is
 * short a certified operator, NOT a schedule blocker). NO labor action: explain coverage; never
 * assign operators or optimize staffing. `operator`/`station` default to the screen selection.
 */
const RETRIEVE_COVERAGE_TOOL: LlmTool = {
  name: 'retrieve_coverage',
  description:
    "Return workforce coverage — the same grid the Workforce screen shows: who is qualified for each station, where the cert gaps are, next-shift readiness, and the screen's call-in proposal. Use for coverage / readiness / 'who can run X' / 'this gap / operator'. A gap is ADVISORY (an observation; certs are soft and do not block the schedule). Explain only — never assign operators or optimize labor. Omit operator/station to use what is on screen.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Nullable: some models emit explicit null for an omitted optional param; the dispatch treats
      // null/undefined the same (falls back to the screen selection / whole plant).
      operator: {
        type: ['string', 'null'],
        description:
          'an operator name to focus on; omit for the whole plant or the on-screen selection',
      },
      station: {
        type: ['string', 'null'],
        description: 'a station/certification name to focus on (e.g. leak-test)',
      },
    },
  },
}

/**
 * Goal-seek (decide-support, Pass: grounded by construction). Finds the value of a lever that
 * achieves a goal — the ENGINE searches; the model NEVER picks the value. First lever: overtime
 * hours to clear the firm at-risk on a line. Distinct from evaluate_what_if (which takes a GIVEN
 * value): goal_seek answers "how much do I need", evaluate answers "what happens if I add X".
 */
const GOAL_SEEK_TOOL: LlmTool = {
  name: 'goal_seek',
  description:
    "Find the OVERTIME hours that CLEAR the firm at-risk on a line — the ENGINE searches for the value; you NEVER choose it. Use for 'how much overtime do I need / add overtime until it clears / what overtime clears the at-risk'. For a GIVEN value ('add 4h overtime'), use evaluate_what_if instead. Returns the minimal hours that clears it (with an appliable scenario), or that no amount within the line's overtime cap clears it.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      resourceId: {
        type: ['string', 'null'],
        description: 'the line to add overtime on; omit to use the line selected on screen',
      },
    },
  },
}

/**
 * Explain-lateness (causal attribution, D-late) — return an order's computed lateness chain: the
 * binding op at each hop down to a root (material / capacity / working_window / due_before_start /
 * resource_downtime).
 * Every hop is a stored engine fact (the floor that set the start), so the Copilot narrates the chain
 * and NEVER infers a link. Type-1: retrieve + translate. `demandLineId` defaults to the screen selection.
 */
const EXPLAIN_LATENESS_TOOL: LlmTool = {
  name: 'explain_lateness',
  description:
    "Explain WHY an order is late — return its computed causal chain: the blocking op at each hop down to a root cause (material gate / resource capacity / working window / due-before-start). Use for 'why is X late / what's blocking X / why did X slip / what made it late'. Narrate the hops IN ORDER as the chain; each hop is a computed engine fact — NEVER infer or add a blocker that is not in the returned chain. Omit demandLineId to use the order selected on screen.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      demandLineId: {
        type: ['string', 'null'],
        description: 'the order id (demandLineId) to explain; omit to use the on-screen selection',
      },
    },
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
const CLAIM_RX =
  /\d|otif|oee|changeover|displacement|overtime|cost\/unit|late order|option|reroute|defer/i

/** A demand order in the entity catalog (the conversation's resolution surface). */
type CatalogOrder = {
  demandLineId: string
  releaseReference: string | null
  customer: string
  part: string
  qty: number
  firmness: string
  due: string
}

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
    private readonly planComparison: PlanComparisonService,
    private readonly gateway: LlmGateway
  ) {}

  /** Start a conversation (auto-named) and process the first turn. */
  async create(
    tenantId: string,
    plantId: string,
    message: string,
    userId: string | null,
    screenContext?: ScreenContext
  ): Promise<ConversationDetailDto> {
    const conv = await this.repo.createConversation({
      tenantId,
      plantId,
      name: nameFrom(message),
      createdBy: userId,
    })
    await this.processTurn(tenantId, conv, message, userId, screenContext)
    return this.get(tenantId, conv.id)
  }

  /** Add a user turn to an existing conversation; returns the assistant turn. */
  async addTurn(
    tenantId: string,
    conversationId: string,
    message: string,
    userId: string | null,
    screenContext?: ScreenContext
  ): Promise<ConversationTurnDto> {
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
    if (!row)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'Conversation not found',
        ERROR_CODES.CONVERSATION_NOT_FOUND
      )
    return toConversationDto(row)
  }

  // --- the turn engine -------------------------------------------------------
  private async processTurn(
    tenantId: string,
    conv: Conversation,
    message: string,
    userId: string | null,
    screenContext?: ScreenContext
  ): Promise<ConversationTurnDto> {
    await this.repo.createTurn({
      tenantId,
      conversationId: conv.id,
      role: 'user',
      content: message,
    })
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

    const catalog = plantId
      ? await this.scheduling.entityCatalog(tenantId, plantId)
      : { orders: [], resources: [] }
    // Inline only the nearest-due slice (catalog is already due-sorted); find_orders covers the rest.
    const orderSlice = catalog.orders.slice(0, ORDER_SLICE_CAP)
    const screenLine = renderScreenContext(screenContext, catalog)

    // Context carry (Pass B): the change-set that produced the active analysis, so a follow-up that
    // CONSTRUCTS an option ("give me a fourth option using overtime", "add 4h overtime to this")
    // inherits the scenario instead of re-specifying it. The active result is the on-screen one (or
    // the conversation's latest); its stored change-set is rendered into the prompt.
    const activeResult = activeResultId
      ? await this.repo.findWhatIfResult(tenantId, activeResultId)
      : undefined
    const scenarioLine = activeResult ? renderActiveScenario(activeResult.changeSet, catalog) : null

    // Firm at-risk lines (committed plan) — the grounded default target for an unspecified overtime
    // line, so "a fourth option using overtime" resolves the line itself. goal_seek validates it.
    let atRiskResourceIds: string[] = []
    if (plantId) {
      try {
        const sc = await this.scheduling.scorecard(tenantId, plantId)
        atRiskResourceIds = [...new Set(sc.atRisk.map((a) => a.resourceId))]
      } catch {
        atRiskResourceIds = []
      }
    }
    const atRiskLineNames = atRiskResourceIds.map(
      (id) => catalog.resources.find((r) => r.id === id)?.name ?? id
    )

    const system = buildSystemPrompt(
      orderSlice,
      catalog.resources,
      catalog.orders.length,
      screenLine,
      scenarioLine,
      atRiskLineNames
    )
    const messages = prior.map((t) => ({ role: t.role, content: t.content }))

    // The structure-derived change-set echo for a Type-2 turn — captured from the engine's ledger
    // (never LLM free-text) and prepended to the answer so the planner always sees exactly what
    // was applied / not applied (the never-silently-drop guarantee, conversation Pass A).
    let lastLedger: RequestedChange[] | null = null
    // The structure-derived goal-seek finding — rendered (never the model's number) and prepended
    // so a suggested value is grounded-by-construction (the engine found it). The flag is a plain
    // boolean (not read off the closure-mutated object) so a not-achieving goal-seek doesn't
    // inherit a stale result.
    let lastGoalSeek: GoalSeekResult | null = null
    let goalSeekNoResultFlag = false

    const dispatch: ToolDispatch = async (call: LlmToolCall) => {
      if (call.name === 'retrieve_what_if') {
        const r = activeResultId
          ? await this.repo.findWhatIfResult(tenantId, activeResultId)
          : undefined
        if (!r)
          return {
            content:
              'No stored what-if analysis exists for this plant yet — describe a scenario to evaluate, or say you cannot answer.',
            groundedRefs: [],
          }
        const sel = applySelectability(r.options as WhatIfOption[], r.changeSet as ChangeSet)
        return {
          content: JSON.stringify(
            compactArtifact(r.id, sel.recommendedOptionId, r.baseKpis, sel.options, undefined, sel.unremediable)
          ),
          groundedRefs: [r.id],
        }
      }
      if (call.name === 'compare_options') {
        const r = activeResultId
          ? await this.repo.findWhatIfResult(tenantId, activeResultId)
          : undefined
        if (!r)
          return {
            content:
              'No what-if analysis to compare yet — evaluate a scenario first, then compare.',
            groundedRefs: [],
          }
        // Same artifact as retrieve; the structured side-by-side TABLE is rendered client-side from
        // the result (the tool name is the render signal). The model narrates the trade-off only.
        const sel = applySelectability(r.options as WhatIfOption[], r.changeSet as ChangeSet)
        return {
          content: JSON.stringify(
            compactArtifact(r.id, sel.recommendedOptionId, r.baseKpis, sel.options, undefined, sel.unremediable)
          ),
          groundedRefs: [r.id],
        }
      }
      if (call.name === 'evaluate_what_if') {
        // origin is optional in the tool schema (some models omit it); default to a planner-initiated
        // 'manual' change so the Zod gate passes. The change KINDS — not origin — drive the option family.
        const rawChangeSet = (call.input as { changeSet?: { origin?: unknown } }).changeSet
        if (rawChangeSet && typeof rawChangeSet === 'object' && rawChangeSet.origin == null) {
          rawChangeSet.origin = { type: 'manual' }
        }
        const parsed = changeSetSchema.safeParse(rawChangeSet)
        if (!parsed.success)
          return {
            content: `Invalid change-set: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
            isError: true,
          }
        try {
          const res = await this.whatIf.evaluate(tenantId, plantId, parsed.data, undefined, userId)
          activeResultId = res.id
          lastLedger = res.requestedChanges
          return {
            content: JSON.stringify(
              compactArtifact(
                res.id,
                res.recommendedOptionId,
                res.baseKpis,
                res.options,
                res.requestedChanges,
                res.unremediable
              )
            ),
            groundedRefs: [res.id],
            resultId: res.id,
          }
        } catch (e) {
          const code = e instanceof AppException ? e.code : 'error'
          return {
            content: `The engine could not evaluate that change (${code}). Ask the planner to clarify or decline.`,
            isError: true,
          }
        }
      }
      if (call.name === 'retrieve_baseline') {
        const input = call.input as { arm?: string; scope?: string }
        // arm: named override → scorecard's published arm (view) → default engine-lift.
        const armRaw =
          input.arm ?? (screenContext?.screen === 'scorecard' ? screenContext.view : undefined)
        const arm: BaselineSource =
          armRaw === 'historical' || armRaw === 'measured_historical'
            ? 'measured_historical'
            : 'frozen_engine_snapshot'
        // scope: named line → screen-context scope → whole plant.
        const scope = input.scope ?? screenContext?.selectedResourceId ?? undefined
        const dto = await this.planComparison.compare(tenantId, plantId, arm, scope)
        const resName = scope
          ? (catalog.resources.find((r) => r.id === scope)?.name ?? scope)
          : null
        return {
          content: JSON.stringify(compactBaseline(dto, resName)),
          groundedRefs: dto.scheduleVersionId ? [dto.scheduleVersionId] : [],
        }
      }
      if (call.name === 'goal_seek') {
        // Line resolution: named line → screen-selected line → the single firm at-risk line (carried
        // context, so "a fourth option using overtime" needn't name it). Ask only when ambiguous.
        const resourceId =
          (call.input as { resourceId?: string }).resourceId ??
          screenContext?.selectedResourceId ??
          (atRiskResourceIds.length === 1 ? atRiskResourceIds[0] : undefined)
        if (!resourceId)
          return {
            content: JSON.stringify({
              needResource: true,
              note: 'Ask the planner which line to add overtime on.',
            }),
            groundedRefs: [],
          }
        const gs = await this.whatIf.goalSeek(tenantId, plantId, resourceId, userId)
        lastGoalSeek = gs
        goalSeekNoResultFlag = !gs.resultId
        if (gs.resultId) activeResultId = gs.resultId
        return {
          content: JSON.stringify(compactGoalSeek(gs)),
          groundedRefs: gs.resultId ? [gs.resultId] : [plantId],
          resultId: gs.resultId ?? undefined,
        }
      }
      if (call.name === 'explain_lateness') {
        // Named order → screen-selected order (deictic "why is this late"). Resolve a ref via the catalog.
        const raw =
          (call.input as { demandLineId?: string }).demandLineId ?? screenContext?.selectedOrderId
        const match = raw
          ? catalog.orders.find(
              (o: CatalogOrder) =>
                o.demandLineId.toLowerCase() === raw.toLowerCase() ||
                (o.releaseReference ?? '').toLowerCase() === raw.toLowerCase()
            )
          : undefined
        const demandLineId = match?.demandLineId ?? raw
        if (!demandLineId)
          return {
            content: JSON.stringify({
              needOrder: true,
              note: 'Ask the planner which order to explain.',
            }),
            groundedRefs: [],
          }
        const chains = await this.scheduling.latenessForOrder(tenantId, plantId, demandLineId)
        return {
          content: JSON.stringify(compactLateness(demandLineId, chains)),
          groundedRefs: [plantId],
        }
      }
      if (call.name === 'retrieve_coverage') {
        const input = call.input as { operator?: string; station?: string }
        const cov = await this.scheduling.coverage(tenantId, plantId)
        // Focus: named operator/station → screen-context selected operator (deictic) → whole plant.
        const opByName = input.operator
          ? cov.operators.find((o) => o.label.toLowerCase().includes(input.operator!.toLowerCase()))
          : undefined
        const opById =
          !input.operator && screenContext?.selectedOperatorId
            ? cov.operators.find((o) => o.id === screenContext.selectedOperatorId)
            : undefined
        const station = input.station
          ? cov.stations.find((s) => s.label.toLowerCase().includes(input.station!.toLowerCase()))
          : undefined
        const focus =
          (opByName ?? opById)
            ? {
                type: 'operator' as const,
                id: (opByName ?? opById)!.id,
                label: (opByName ?? opById)!.label,
              }
            : station
              ? { type: 'station' as const, id: station.id, label: station.label }
              : null
        return { content: JSON.stringify(compactCoverage(cov, focus)), groundedRefs: [plantId] }
      }
      if (call.name === 'find_orders') {
        const q = String((call.input as { query?: unknown }).query ?? '')
          .toLowerCase()
          .trim()
        const matches = q
          ? catalog.orders.filter(
              (o: CatalogOrder) =>
                o.demandLineId.toLowerCase().includes(q) ||
                (o.releaseReference ?? '').toLowerCase().includes(q) ||
                o.customer.toLowerCase().includes(q) ||
                o.part.toLowerCase().includes(q)
            )
          : []
        const note =
          matches.length === 0
            ? 'No order matches — ask the planner to clarify; do not guess or evaluate.'
            : matches.length === 1
              ? 'Exactly one match — safe to use its demandLineId.'
              : 'Multiple orders match — ASK the planner which one (name the customer/part/due); never guess.'
        return {
          content: JSON.stringify({
            matchCount: matches.length,
            orders: matches.slice(0, FIND_ORDERS_LIMIT),
            note,
          }),
          groundedRefs: [],
        }
      }
      return { content: 'Unknown tool.', isError: true }
    }

    try {
      const loop = await this.gateway.runToolLoop(
        {
          system,
          messages,
          tools: [
            RETRIEVE_TOOL,
            COMPARE_OPTIONS_TOOL,
            EVALUATE_TOOL,
            GOAL_SEEK_TOOL,
            FIND_ORDERS_TOOL,
            RETRIEVE_BASELINE_TOOL,
            RETRIEVE_COVERAGE_TOOL,
            EXPLAIN_LATENESS_TOOL,
          ],
        },
        dispatch
      )
      let content = loop.text || 'I could not produce a response.'
      let status: 'ok' | 'degraded' = 'ok'
      // Detectable non-fabrication violation: a scheduling claim with no grounding/tool call.
      if (loop.groundedRefs.length === 0 && loop.toolCalls.length === 0 && CLAIM_RX.test(content)) {
        this.logger.warn(
          `grounding violation in conversation ${conv.id}: scheduling claim without groundedRefs`
        )
        content =
          'I can only answer from the computed analysis and I do not have a grounded result for that — ask about the current options, or describe a scenario to evaluate.'
        status = 'degraded'
      }
      // Never silently drop: a Type-2 turn always leads with the structure-derived echo of what
      // the engine actually applied (and what it couldn't), independent of the model's prose.
      if (lastLedger) {
        const echo = renderChangeEcho(lastLedger)
        if (echo) content = `${echo}\n\n${content}`
      }
      // Grounded-by-construction: a goal-seek answer leads with the engine-found value, rendered
      // (never the model's number) — closes the suggest-a-value guess hole.
      if (lastGoalSeek) content = `${renderGoalSeek(lastGoalSeek)}\n\n${content}`
      // The turn's resultId is a FRESH result this turn produced, else the active-context result for
      // continuity — EXCEPT a goal-seek that found nothing must not inherit a stale result (it would
      // render an unrelated option-set under a "not achievable" answer).
      const turnResultId = loop.resultIds[0] ?? (goalSeekNoResultFlag ? null : activeResultId)
      const turn = await this.repo.createTurn({
        tenantId,
        conversationId: conv.id,
        role: 'assistant',
        content,
        groundedRefs: loop.groundedRefs,
        toolCalls: loop.toolCalls.map((c) => ({ name: c.name, input: c.input })),
        resultId: turnResultId,
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
        content:
          'I could not process that just now — the analysis and options are still available alongside.',
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
    if (!conv)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'Conversation not found',
        ERROR_CODES.CONVERSATION_NOT_FOUND
      )
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
// English for the model (the API has no i18next; mirrors the FE `whatif.json` `unremediable.*` keys).
function unremediableReasonEn(key: string): string {
  if (key === 'whatif.unremediable.atRisk') return 'No available remediation makes this op runnable as scheduled.'
  if (key === 'whatif.unremediable.cantBeOnTime') return 'No scheduling change can bring this order in on time.'
  return 'No feasible plan for this change.'
}
function unremediableLeversEn(key: string): string {
  if (key === 'whatif.unremediable.atRiskLevers') return 'split the op, re-promise the date, or change the requirement'
  if (key === 'whatif.unremediable.cantBeOnTimeLevers') return 'renegotiate the date, or expedite the gating input'
  return ''
}

function compactArtifact(
  id: string,
  recommendedOptionId: string | null,
  baseKpis: unknown,
  options: WhatIfOption[],
  requestedChanges?: RequestedChange[],
  unremediable?: WhatIfUnremediable | null
) {
  const labelOf = (optId: string) =>
    optionLabelEn(options.find((o) => o.id === optId)?.labelKey ?? optId)
  // Only SELECTABLE options (a runnable plan) get a stat block — a non-running plan's KPIs describe a
  // plan that won't run, so showing them would dress a non-option up as comparable. The rest are demoted
  // to lever NAMES only ("also evaluated — none make it runnable"), so the model can name them without
  // implying they're choices. When NOTHING is selectable, the honest-unachievable verdict leads.
  const selectable = options.filter((o) => o.feasible)
  const demotedLevers = [...new Set(options.filter((o) => !o.feasible).map((o) => optionLabelEn(o.labelKey)))]
  return {
    resultId: id,
    unremediable: unremediable ? { reason: unremediableReasonEn(unremediable.reasonKey), levers: unremediable.leversKey ? unremediableLeversEn(unremediable.leversKey) : null } : undefined,
    recommendedOption: recommendedOptionId ? labelOf(recommendedOptionId) : null,
    demotedLevers: demotedLevers.length > 0 ? demotedLevers : undefined,
    // What the engine actually did with each requested change (Type-2 only) — so the model's prose
    // can speak to anything not fully applied. The planner-facing echo is rendered separately.
    requestedChanges: requestedChanges?.map((c) => ({
      change: c.summary,
      status: c.status,
      note: c.note,
    })),
    baseKpis,
    options: selectable.map((o) => ({
      option: optionLabelEn(o.labelKey),
      rank: o.rank,
      feasible: o.feasible,
      infeasibleReason: o.infeasibleReasonKey ? 'no feasible schedule for this change' : null,
      score: o.score,
      kpis: o.kpis,
      factors: o.rationale.factors.map((f) => {
        // The lateness factor's rawValue folds in the infeasibility sentinel (100_000/op) for SCORING;
        // never narrate that — show the honest due-late hours + the infeasible-op count instead, so the
        // model never says "100000 hours late". (The sentinel stays in `contribution`/`score`, which is
        // what actually ranks the option.)
        const infeasibleOps = o.kpis.infeasibleFirmOps ?? 0
        if (f.key === 'lateness' && infeasibleOps > 0) {
          return { factor: factorLabelEn(f.key), value: o.kpis.firmLateHours ?? 0, unit: f.unit, infeasibleOps, contribution: f.contribution, direction: f.direction }
        }
        return { factor: factorLabelEn(f.key), value: f.rawValue, unit: f.unit, contribution: f.contribution, direction: f.direction }
      }),
      constraints: o.rationale.constraints.map((c) => ({
        constraint: CONSTRAINT_LABEL[c.key] ?? c.key,
        binding: c.binding,
        slack: c.slack,
      })),
      comparatives: o.rationale.comparatives.map((c) => ({
        versus: labelOf(c.vsOptionId),
        verdict: c.verdict,
        decidingFactors: c.decidingFactors.map((d) => ({
          factor: factorLabelEn(d.key),
          delta: d.delta,
        })),
      })),
    })),
  }
}

const round4 = (n: number): number => Number(n.toFixed(4))
/** Per-KPI live/baseline/delta + direction, deterministic — the model translates, never computes. */
function kpiDelta(
  live: number | null,
  base: number | null,
  lowerIsBetter: boolean
): { delta: number | null; direction: 'better' | 'worse' | 'flat' } {
  if (live == null || base == null) return { delta: null, direction: 'flat' }
  const d = round4(live - base)
  if (Math.abs(d) < 1e-9) return { delta: 0, direction: 'flat' }
  return { delta: d, direction: (lowerIsBetter ? d < 0 : d > 0) ? 'better' : 'worse' }
}

/**
 * Compact, LLM-readable view of a baseline comparison (Pass D) — the SAME numbers the scorecard
 * shows (it comes from the same {@link PlanComparisonService.compare}). Per-KPI live/baseline/delta
 * with the delta computed here (deterministic) so the model only translates. Honest empty-state
 * carries an explicit instruction so an absent historical baseline is never fabricated.
 */
export function compactBaseline(dto: PlanComparisonDto, scopeName: string | null) {
  const comparison =
    dto.source === 'measured_historical'
      ? 'measured-historical (vs recorded outcomes)'
      : 'engine-lift (vs the engine with its intelligence off)'
  const scope = scopeName ?? 'the whole plant'
  if (dto.emptyState || !dto.live || !dto.baseline) {
    return {
      comparison,
      scope,
      emptyState: true,
      note:
        dto.source === 'measured_historical'
          ? 'No historical baseline exists yet for this scope — tell the planner so plainly; do NOT invent figures.'
          : 'No comparison is available for this scope — say so; do NOT invent figures.',
    }
  }
  const live = dto.live
  const base = dto.baseline
  const rows: Array<{
    kpi: string
    live: number | null
    baseline: number | null
    lowerIsBetter: boolean
  }> = [
    { kpi: 'OTIF', live: live.otif, baseline: base.otif, lowerIsBetter: false },
    {
      kpi: 'cost per unit',
      live: live.costPerUnit,
      baseline: base.costPerUnit,
      lowerIsBetter: true,
    },
    {
      kpi: 'OEE',
      live: live.oee?.oee ?? null,
      baseline: base.oee?.oee ?? null,
      lowerIsBetter: false,
    },
    { kpi: 'late orders', live: live.lateOrders, baseline: base.lateOrders, lowerIsBetter: true },
    { kpi: 'throughput', live: live.throughput, baseline: base.throughput, lowerIsBetter: false },
  ]
  return {
    comparison,
    scope,
    emptyState: false,
    kpis: rows
      .filter((r) => !(r.live == null && r.baseline == null))
      .map((r) => ({
        kpi: r.kpi,
        live: r.live,
        baseline: r.baseline,
        ...kpiDelta(r.live, r.baseline, r.lowerIsBetter),
      })),
  }
}

/**
 * Compact, LLM-readable view of workforce coverage (Pass D) — the SAME grid the Workforce screen
 * shows (from {@link SchedulingService.coverage}). Per-station qualified-present / qualified-out /
 * gap, per-operator qualifications, readiness, and the screen's call-in proposals. A gap is framed
 * **advisory** (`note`): certs are soft (C3) — being short a certified operator is an observation,
 * not a schedule blocker. Explain-only; nothing here assigns labor.
 */
export function compactCoverage(
  cov: WorkforceCoverageDto,
  focus: { type: 'operator' | 'station'; id: string; label: string } | null
) {
  if (cov.stations.length === 0 || cov.operators.length === 0) {
    return {
      focus: 'the whole plant',
      emptyState: true,
      note: 'No workforce coverage data for this plant — say so; do NOT invent operators or certifications.',
    }
  }
  const stations = cov.stations.map((s, j) => {
    const qualified = cov.operators.filter((_, i) => cov.cells[i]?.[j] === 'qualified')
    const present = qualified.filter((o) => !o.out).map((o) => o.label)
    const out = qualified.filter((o) => o.out).map((o) => o.label)
    return {
      station: s.label,
      covered: present.length > 0,
      gap: present.length === 0,
      qualifiedPresent: present,
      qualifiedOut: out,
    }
  })
  const operators = cov.operators.map((o, i) => ({
    operator: o.label,
    available: !o.out,
    // Why out (drives call-in eligibility): not_scheduled = callable; vacation = tentative; sick = never.
    absenceReason: o.out ? (o.outReason ?? null) : null,
    qualifiedFor: cov.stations
      .filter((_, j) => cov.cells[i]?.[j] === 'qualified')
      .map((s) => s.label),
  }))
  return {
    focus: focus ? `${focus.type} ${focus.label}` : 'the whole plant',
    emptyState: false,
    readinessPct: round4(cov.readinessPct),
    certGapCount: cov.certGapCount,
    // A gap is ADVISORY — certs are soft (C3): the plant is short a certified operator for the
    // station; it does NOT block or delay the schedule. Do not overstate what a gap does.
    gapMeaning:
      'advisory: short a certified operator for the station; certifications are soft and do NOT block the schedule',
    stations,
    operators,
    proposals: cov.proposals.map((p) => ({
      station: p.station,
      suggestedCallIn: p.operatorName,
      reason: p.reason,
      absenceReason: p.absenceReason,
      // tentative = the only fill is on vacation; the call-in may not be possible — say so, confirm first.
      tentative: p.tentative,
    })),
    proposalNote:
      'A call-in to a not_scheduled (off-shift) operator is a clean OT fill; a tentative proposal is an operator on VACATION — flag that it may not be possible and to confirm first. Sick operators are never proposed. A gap with no proposal has no one callable.',
  }
}

/**
 * Compact, LLM-readable view of an order's causal lateness chains (D-late) — from
 * {@link SchedulingService.latenessForOrder}. Each hop is the engine's recorded binding (the floor
 * that set an op's start); the model narrates the hops IN ORDER and must NOT add a link not listed.
 * One entry per at-risk op of the order (an order can be late on more than one op).
 */
export function compactLateness(demandLineId: string, chains: LatenessChainDto[]) {
  if (chains.length === 0) {
    return {
      order: demandLineId,
      late: false,
      note: 'This order is not at-risk in the committed plan — say it is on track; do NOT invent a cause.',
    }
  }
  return {
    order: demandLineId,
    late: true,
    chains: chains.map((c) => ({
      root: c.root,
      truncated: c.truncated,
      hops: c.hops.map((h) => ({
        order: h.demandLineId,
        op: h.opSeq,
        resource: h.resourceName,
        part: h.partNo,
        kind: h.kind,
        detail: h.detail,
        // line-down vs maintenance on a resource_downtime root (so the narration names the closure honestly)
        ...(h.downtimeKind ? { downtimeKind: h.downtimeKind } : {}),
      })),
    })),
    note: 'Narrate the hops IN ORDER as the causal chain (op held by → its blocker → … → root). Every hop is a computed engine fact; NEVER add or infer a blocker not in this list. If truncated, say the chain was truncated.',
  }
}

/**
 * The CURRENT SCREEN line (Pass B) — a planner-readable snapshot of what's on screen, with the
 * selected order rendered by its human release reference and the selected line by name. Returns
 * null when there's no screen context (→ pure Pass A behavior). Used only to resolve deictic refs.
 */
export function renderScreenContext(
  sc: ScreenContext | undefined,
  catalog: { orders: CatalogOrder[]; resources: { id: string; name: string }[] }
): string | null {
  if (!sc) return null
  const orderRef = (id: string): string => {
    const o = catalog.orders.find((x) => x.demandLineId === id)
    return o?.releaseReference ? `${o.demandLineId} (${o.releaseReference})` : id
  }
  const resName = (id: string): string => catalog.resources.find((x) => x.id === id)?.name ?? id
  // Per-screen natural phrasing of the deictic referent (Pass C).
  if (sc.screen === 'scorecard') {
    const arm = sc.view === 'measured_historical' ? 'measured-historical' : 'engine-lift'
    const scope = sc.selectedResourceId
      ? `scope ${resName(sc.selectedResourceId)}`
      : 'scope the whole plant'
    return `the scorecard — the ${arm} comparison, ${scope}`
  }
  if (sc.screen === 'exception') {
    return sc.selectedOrderId
      ? `the exception queue — at-risk order ${orderRef(sc.selectedOrderId)} selected`
      : 'the exception queue (no order selected)'
  }
  if (sc.screen === 'workforce') {
    // The operator name lives in the coverage data (resolved by retrieve_coverage), so the line
    // just flags that a selection exists — "this operator / gap" → retrieve_coverage uses the id.
    return sc.selectedOperatorId
      ? 'the workforce coverage view, an operator selected (its id is the deictic referent)'
      : 'the workforce coverage view (no operator selected)'
  }
  // Board (and any other screen) — the generic selection rendering.
  const parts: string[] = [`screen ${sc.screen}${sc.view ? ` (${sc.view} view)` : ''}`]
  if (sc.selectedOrderId) parts.push(`selected order ${orderRef(sc.selectedOrderId)}`)
  if (sc.selectedResourceId) parts.push(`selected line ${resName(sc.selectedResourceId)}`)
  if (sc.activeResultId) parts.push('a what-if analysis is open on screen')
  return parts.join(', ')
}

/**
 * Render the active analysis's change-set as human-readable lines (the CURRENT SCENARIO block) so a
 * follow-up that constructs a new option inherits it. Orders read by release reference, lines by name.
 */
export function renderActiveScenario(
  changeSet: ChangeSet,
  catalog: { orders: CatalogOrder[]; resources: { id: string; name: string }[] }
): string {
  const orderRef = (id: string): string => {
    const o = catalog.orders.find((x) => x.demandLineId === id)
    return o?.releaseReference ? `${o.demandLineId} (${o.releaseReference})` : id
  }
  const resName = (id: string): string => catalog.resources.find((x) => x.id === id)?.name ?? id
  const describe = (c: Change): string => {
    switch (c.kind) {
      case 'demand_qty':
        return `set ${orderRef(c.demandLineId)} quantity to ${c.to}`
      case 'demand_date':
        return `move ${orderRef(c.demandLineId)} due date to ${c.to}`
      case 'resource_window':
        return `take ${resName(c.resourceId)} down (${c.downFrom}–${c.downTo})`
      case 'line_down':
        return `${resName(c.resourceId)} is down`
      case 'overtime':
        return `add ${c.hours}h overtime on ${resName(c.resourceId)}`
      case 'wear_remediation':
        return `${c.action} on ${resName(c.resourceId)}`
      case 'material_arrival':
        return `material ${c.componentPartId} arrives ${c.availableAt}`
      case 'at_risk_remediation':
        return `remediate at-risk order ${orderRef(c.demandLineId)}`
    }
  }
  return changeSet.changes.map(describe).join('; ')
}

/** The ground-never-fabricate + routing system prompt, with a near-horizon entity slice inlined. */
export function buildSystemPrompt(
  orderSlice: CatalogOrder[],
  resources: unknown[],
  totalOrders: number,
  screenLine: string | null,
  scenarioLine?: string | null,
  atRiskLineNames?: string[]
): string {
  const scenarioBlock = scenarioLine
    ? [
        '',
        `CURRENT SCENARIO (the analysis on screen / just produced) was generated by this change-set: ${scenarioLine}.`,
        'A follow-up that asks for ANOTHER/A FOURTH option, or to ADD/TRY a lever ("give me a fourth option using overtime", "what if I also take Press B down", "add 4h overtime to this change") is SCENARIO CONSTRUCTION, not retrieval. Build a NEW change-set = the current scenario\'s changes ABOVE plus the planner\'s new lever (a compound), and call evaluate_what_if. The stored option set is fixed — you cannot retrieve an option that was never computed.',
        atRiskLineNames && atRiskLineNames.length > 0
          ? `Firm at-risk in the committed plan is on: ${atRiskLineNames.join(', ')}. For an overtime lever with no line named, default to it (goal_seek / the overtime change-item) — ask only if more than one line is at-risk.`
          : '',
      ].filter(Boolean)
    : []
  const screenBlock = screenLine
    ? [
        '',
        `CURRENT SCREEN: the planner is viewing ${screenLine}.`,
        'Use the current screen ONLY to resolve a DEICTIC or unspecified reference — "this", "it", "here", "this order", "this line", "the current option". Resolve such a reference to the matching on-screen selection (and "this option / why not X" to the analysis open on screen).',
        'A NAMED entity ALWAYS WINS: if the planner names an order or line (by id, release reference, customer, or part), resolve THAT via the inline list / find_orders and IGNORE the on-screen selection — even when a different order is selected. Screen context is a default for deictic references, never a filter on what you can reach.',
        'If a deictic reference has NO matching on-screen selection (e.g. "this order" but no order is selected), ASK which one — do NOT fall back to anything or guess.',
        'On the scorecard, "this lift / comparison / KPI delta" → call retrieve_baseline (it defaults to the arm + scope on screen); explain the returned numbers.',
        'On the workforce view, "this operator / this gap / who can run X / where are we short" → call retrieve_coverage (it defaults to the selected operator on screen); explain the returned coverage. A cert gap is ADVISORY — the plant is short a certified operator for that station; certifications are soft and do NOT block or delay the schedule, so never say a gap stops production.',
        'Labor boundary (permanent): you EXPLAIN coverage — who is qualified, where the gaps are, and the screen’s call-in proposal. You do NOT assign operators, optimize labor, choose who to staff, or recommend a roster. If asked to assign or staff, decline plainly (that is outside the system) and offer the coverage facts instead. Never assign.',
      ]
    : []
  return [
    'You are a scheduling copilot for a production planner. You answer ONLY using tools; you NEVER state a scheduling number or result from your own reasoning.',
    '',
    'Tools:',
    '- retrieve_what_if: the stored, already-computed analysis. Use it for ANY question about the existing options/factors/constraints/costs. No new computation.',
    '- compare_options: render a SIDE-BY-SIDE table of the current options (options × KPIs). Use when asked to compare / "side by side". The table is shown automatically — narrate the trade-off, do NOT retype the figures.',
    '- evaluate_what_if: runs the deterministic engine on a NEW scenario you express as a change-set (a GIVEN value). Use it for a change not in the stored analysis.',
    '- goal_seek: finds the overtime hours that CLEAR the firm at-risk on a line — the ENGINE searches for the value. Use when asked HOW MUCH (overtime) is needed, not for a given amount.',
    '- find_orders: look up a demand order (by id, release reference, customer, or part) not in the inline list below, or to confirm which order an ambiguous reference means.',
    '- retrieve_baseline: the live plan vs a baseline arm (engine-lift / historical) — the same comparison the scorecard shows. Use for the baseline / "the lift" / "vs baseline" / a KPI delta. No computation.',
    '- retrieve_coverage: workforce coverage — who is qualified per station, cert gaps, readiness, and the call-in proposal (the same grid the Workforce screen shows). Use for coverage / readiness / "who can run X" / a gap. Explain only — never assign labor.',
    '',
    'Routing:',
    '- A question about the existing analysis → call retrieve_what_if, then answer from what it returns.',
    '- "compare these options / side by side / which is best across the KPIs" → call compare_options (a table renders); then narrate the trade-off WITHOUT repeating the numbers.',
    '- A new scenario with a GIVEN value ("add 4h overtime", "set qty to 500") → evaluate_what_if.',
    '- "give me / add / generate / try another (or a fourth) option" WITH a new lever (overtime, take a line down, change a qty/date) → SCENARIO CONSTRUCTION → evaluate_what_if (build a change-set; if a scenario is on screen, a compound that augments it). The word "option" does NOT mean retrieve when a NEW lever is named — retrieve_what_if is only for the options ALREADY computed.',
    '- A new lever named WITHOUT a value — "using/with overtime" (no hours) → goal_seek (the engine finds the hours). Never decline for a missing number and never invent one; if the line is unknown and not derivable from context, ask which line.',
    '- A "how much / what value" question ("how much overtime to clear the at-risk", "add overtime until it clears") → goal_seek (the engine finds the value). NEVER pick the value yourself.',
    '- A question about the baseline / the lift / vs-baseline / a KPI delta → call retrieve_baseline, then explain the returned numbers.',
    '- A question about workforce coverage / readiness / qualifications / a cert gap → call retrieve_coverage, then explain it (a gap is advisory, not a schedule blocker).',
    '- If retrieve_what_if returns nothing relevant → construct a what-if or say you do not have that. NEVER estimate.',
    '- Off-domain or unanswerable (not this plant’s scheduling) → say you cannot help. Do NOT call a tool. Do NOT fabricate.',
    '',
    'Change-set construction — map names to ids using these plant entities. Each order has a demandLineId (internal id), a releaseReference (the id the planner reads off the board, e.g. GM-830-1142), customer, part, qty, and due date.',
    `ORDERS (nearest ${orderSlice.length} of ${totalOrders} by due date): ${JSON.stringify(orderSlice)}`,
    `LINES: ${JSON.stringify(resources)}`,
    'Resolution: match a reference to an order by demandLineId OR releaseReference OR customer/part. If the order is NOT in the list above, call find_orders. DISAMBIGUATION: if a reference matches more than one order (in the list or via find_orders), ASK the planner which one — name the distinguishing customer/part/due. Never guess an id, and never call evaluate_what_if on a guessed order.',
    ...screenBlock,
    ...scenarioBlock,
    'A change-set is { origin:{type}, changes:[ … ] }. If a request cannot map to the change kinds, say you cannot evaluate it.',
    '',
    'Faithfulness: evaluate_what_if returns `requestedChanges` — what the engine did with EACH change you asked for (applied / partial / unapplied, with a note). A plain-language summary of these is shown to the planner automatically, so do NOT repeat the list verbatim. But you MUST NOT imply a change took effect if its status is partial or unapplied — explain the consequence (e.g. "the overtime could not be added because that resource has no overtime allowance"). Never present a half-applied scenario as fully done.',
    'Grounding: every scheduling fact must come from a tool result; keep numbers exactly as returned. Be concise, like a planner’s note. You explain and construct — you never apply or commit.',
    'NEVER suggest a scheduling value (overtime hours, a quantity, a date) from your own reasoning — that is fabrication even if it sounds plausible. To suggest a value, call goal_seek (the engine finds it) and report only the value it returns. If a value did not come from a tool result, do not state it.',
    'When you call compare_options, a side-by-side table of the options and their KPIs is rendered to the planner automatically. Do NOT retype those per-option figures in your prose — narrate the TRADE-OFF (what each option prioritises and gives up, which the table supports), the way a planner would summarise it.',
    'For "why is X late", call explain_lateness and narrate the returned chain IN ORDER — each op, the op that held it, down to the root cause. Every hop is a computed engine fact; state ONLY the hops returned and NEVER infer, add, or guess a blocker or a cause that is not in the chain. If the order is not at-risk, say it is on track.',
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
  if (unapplied.length > 0)
    lines.push(`**Not applied:** ${unapplied.map((c) => `${c.summary} — ${c.note}`).join('; ')}.`)
  return lines.join('\n')
}

/** LLM-readable goal-seek artifact — the engine's finding (resource-scoped outcome + value). */
function compactGoalSeek(gs: GoalSeekResult) {
  return {
    lever: `overtime on ${gs.resourceName}`,
    goal: `clear the firm at-risk that ${gs.resourceName} carries`,
    outcome: gs.outcome,
    value: gs.hours != null ? `${gs.hours}h` : null,
    firmAtRiskOnResource: gs.baseFirmLateOnResource,
    overtimeCeilingHours: gs.ceilingHours,
    bindingConstraintOn: gs.elsewhereResources ?? null,
    reason: gs.reason ?? null,
  }
}

/**
 * Render the goal-seek finding (decide-support) — deterministic, never the model's number. Leads a
 * goal-seek answer so the suggested value is grounded-by-construction (the engine found it). The
 * predicate is resource-scoped, so "elsewhere" names where the binding work actually is.
 */
export function renderGoalSeek(gs: GoalSeekResult): string {
  switch (gs.outcome) {
    case 'achieved':
      return `**Found:** ${gs.hours}h overtime on ${gs.resourceName} clears its firm at-risk — the minimum that does.`
    case 'already_clear':
      return `**Already clear:** no firm orders are at risk — no overtime needed.`
    case 'elsewhere':
      return `**Overtime on ${gs.resourceName} won't help:** ${gs.reason}.`
    case 'unachievable':
      return `**Not achievable:** ${gs.reason}.`
  }
}

/** Conversation name from the first message — trimmed, recorded-safe, user-editable. */
function nameFrom(message: string): string {
  const t = message.trim().replace(/\s+/g, ' ')
  return t.length <= 60 ? t : `${t.slice(0, 57)}…`
}

function toConversationDto(c: Conversation): ConversationDto {
  return {
    id: c.id,
    plantId: c.plantId,
    name: c.name,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  }
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
