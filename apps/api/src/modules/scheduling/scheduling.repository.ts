import { Inject, Injectable } from '@nestjs/common'
import type { NarrationMode } from '@perduraflow/contracts'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { SCHEDULING_DB, type SchedulingDatabase } from './scheduling.db'
import {
  conversation,
  conversationTurn,
  demandInput,
  historicalOutcome,
  materialAvailability,
  materialRequirement,
  optimizerRun,
  scheduledOperation,
  scheduleVersion,
  whatIfNarration,
  whatIfResult,
  type Conversation,
  type ConversationTurn,
  type DemandInput,
  type HistoricalOutcome,
  type MaterialAvailability,
  type MaterialRequirement,
  type NewConversation,
  type NewConversationTurn,
  type NewHistoricalOutcome,
  type NewOptimizerRun,
  type NewScheduledOperation,
  type NewScheduleVersion,
  type NewWhatIfNarration,
  type NewWhatIfResult,
  type OptimizerRun,
  type ScheduledOperation,
  type ScheduleVersion,
  type WhatIfNarration,
  type WhatIfResult,
} from './schema'

/** Drizzle queries for the scheduling module (scoped to its own schema, O2). */
@Injectable()
export class SchedulingRepository {
  constructor(@Inject(SCHEDULING_DB) private readonly db: SchedulingDatabase) {}

  // --- demand ----------------------------------------------------------------
  listDemand(tenantId: string, plantId: string): Promise<DemandInput[]> {
    return this.db
      .select()
      .from(demandInput)
      .where(and(eq(demandInput.tenantId, tenantId), eq(demandInput.plantId, plantId)))
      .orderBy(asc(demandInput.requiredDate))
  }

  /** Active demand within the plant, ordered by required date (sequencer input). */
  activeDemand(tenantId: string, plantId: string): Promise<DemandInput[]> {
    return this.db
      .select()
      .from(demandInput)
      .where(
        and(
          eq(demandInput.tenantId, tenantId),
          eq(demandInput.plantId, plantId),
          eq(demandInput.isActive, true),
        ),
      )
      .orderBy(asc(demandInput.requiredDate), asc(demandInput.demandLineId))
  }

  // --- material gate (§4.8 inputs, D36) --------------------------------------
  /** Buy-component requirements (BOM-lite) for the plant — interim until master-data BOM. */
  listMaterialRequirements(tenantId: string, plantId: string): Promise<MaterialRequirement[]> {
    return this.db
      .select()
      .from(materialRequirement)
      .where(and(eq(materialRequirement.tenantId, tenantId), eq(materialRequirement.plantId, plantId)))
  }

  /** Component availability dates for the plant (on-hand + receipts → availableAt). */
  listMaterialAvailability(tenantId: string, plantId: string): Promise<MaterialAvailability[]> {
    return this.db
      .select()
      .from(materialAvailability)
      .where(and(eq(materialAvailability.tenantId, tenantId), eq(materialAvailability.plantId, plantId)))
  }

  /** Set a component's availability date (scenario launcher) — upsert by (tenant, plant, component). */
  async setMaterialAvailability(tenantId: string, plantId: string, componentPartId: string, availableAt: Date): Promise<MaterialAvailability | undefined> {
    const existing = await this.db.query.materialAvailability.findFirst({
      where: and(
        eq(materialAvailability.tenantId, tenantId),
        eq(materialAvailability.plantId, plantId),
        eq(materialAvailability.componentPartId, componentPartId),
      ),
    })
    if (existing) {
      const [row] = await this.db
        .update(materialAvailability)
        .set({ availableAt })
        .where(eq(materialAvailability.id, existing.id))
        .returning()
      return row
    }
    const [row] = await this.db.insert(materialAvailability).values({ tenantId, plantId, componentPartId, availableAt }).returning()
    return row
  }

  // --- runs ------------------------------------------------------------------
  async createRun(data: NewOptimizerRun): Promise<OptimizerRun> {
    const [row] = await this.db.insert(optimizerRun).values(data).returning()
    return row!
  }

  findRun(tenantId: string, id: string): Promise<OptimizerRun | undefined> {
    return this.db.query.optimizerRun.findFirst({
      where: and(eq(optimizerRun.tenantId, tenantId), eq(optimizerRun.id, id)),
    })
  }

  // --- versions + operations -------------------------------------------------
  listVersions(tenantId: string, plantId: string): Promise<ScheduleVersion[]> {
    return this.db
      .select()
      .from(scheduleVersion)
      .where(and(eq(scheduleVersion.tenantId, tenantId), eq(scheduleVersion.plantId, plantId)))
      .orderBy(desc(scheduleVersion.createdAt))
  }

  findVersion(tenantId: string, id: string): Promise<ScheduleVersion | undefined> {
    return this.db.query.scheduleVersion.findFirst({
      where: and(eq(scheduleVersion.tenantId, tenantId), eq(scheduleVersion.id, id)),
    })
  }

  /** The plant's current `committed` version, if any (the supersede target). */
  findCommittedVersion(tenantId: string, plantId: string): Promise<ScheduleVersion | undefined> {
    return this.db.query.scheduleVersion.findFirst({
      where: and(
        eq(scheduleVersion.tenantId, tenantId),
        eq(scheduleVersion.plantId, plantId),
        eq(scheduleVersion.status, 'committed'),
      ),
    })
  }

  operationsForVersion(versionId: string): Promise<ScheduledOperation[]> {
    return this.db
      .select()
      .from(scheduledOperation)
      .where(eq(scheduledOperation.scheduleVersionId, versionId))
      .orderBy(asc(scheduledOperation.resourceId), asc(scheduledOperation.sequencePosition))
  }

  /** Persists a version and its scheduled operations together. */
  async createVersionWithOps(
    version: NewScheduleVersion,
    ops: Omit<NewScheduledOperation, 'scheduleVersionId' | 'tenantId'>[],
  ): Promise<ScheduleVersion> {
    const [row] = await this.db.insert(scheduleVersion).values(version).returning()
    if (ops.length > 0) {
      await this.db
        .insert(scheduledOperation)
        .values(ops.map((op) => ({ ...op, tenantId: row!.tenantId, scheduleVersionId: row!.id })))
    }
    return row!
  }

  async updateVersionStatus(
    tenantId: string,
    id: string,
    patch: Partial<Pick<ScheduleVersion, 'status' | 'supersedesVersionId'>>,
  ): Promise<ScheduleVersion | undefined> {
    const [row] = await this.db
      .update(scheduleVersion)
      .set(patch)
      .where(and(eq(scheduleVersion.tenantId, tenantId), eq(scheduleVersion.id, id)))
      .returning()
    return row
  }

  // --- phase 5: what-if results + narration ----------------------------------
  async createWhatIfResult(data: NewWhatIfResult): Promise<WhatIfResult> {
    const [row] = await this.db.insert(whatIfResult).values(data).returning()
    return row!
  }

  /** A prior result for the same inputs (determinism re-use), newest first. */
  findWhatIfByDeterminismKey(tenantId: string, key: string): Promise<WhatIfResult | undefined> {
    return this.db.query.whatIfResult.findFirst({
      where: and(eq(whatIfResult.tenantId, tenantId), eq(whatIfResult.determinismKey, key)),
      orderBy: desc(whatIfResult.createdAt),
    })
  }

  findWhatIfResult(tenantId: string, id: string): Promise<WhatIfResult | undefined> {
    return this.db.query.whatIfResult.findFirst({
      where: and(eq(whatIfResult.tenantId, tenantId), eq(whatIfResult.id, id)),
    })
  }

  /** The plant's most recent what-if result — the conversation's default Type-1 context. */
  findLatestWhatIfResult(tenantId: string, plantId: string): Promise<WhatIfResult | undefined> {
    return this.db.query.whatIfResult.findFirst({
      where: and(eq(whatIfResult.tenantId, tenantId), eq(whatIfResult.plantId, plantId)),
      orderBy: desc(whatIfResult.createdAt),
    })
  }

  async createNarration(data: NewWhatIfNarration): Promise<WhatIfNarration> {
    const [row] = await this.db.insert(whatIfNarration).values(data).returning()
    return row!
  }

  /**
   * A previously-rendered, **ready** narration for the same (result, option, mode) at
   * the current prompt version — the cache hit that lets a re-opened option reuse the
   * prose instead of re-calling the model. A what-if result is immutable, so the only
   * reason to regenerate is a prompt change (captured by `promptVersion`).
   */
  findReadyNarration(
    tenantId: string,
    resultId: string,
    mode: NarrationMode,
    optionId: string | null,
    promptVersion: string,
  ): Promise<WhatIfNarration | undefined> {
    return this.db.query.whatIfNarration.findFirst({
      where: and(
        eq(whatIfNarration.tenantId, tenantId),
        eq(whatIfNarration.resultId, resultId),
        eq(whatIfNarration.mode, mode),
        optionId == null ? isNull(whatIfNarration.optionId) : eq(whatIfNarration.optionId, optionId),
        eq(whatIfNarration.status, 'ready'),
        eq(whatIfNarration.promptVersion, promptVersion),
      ),
      orderBy: desc(whatIfNarration.createdAt),
    })
  }

  // --- phase 5: historical outcomes (measured_historical arm) ----------------
  /** Historical outcome rows for a plant (optionally one line); empty → no baseline. */
  listHistoricalOutcomes(tenantId: string, plantId: string, resourceId?: string): Promise<HistoricalOutcome[]> {
    return this.db
      .select()
      .from(historicalOutcome)
      .where(
        resourceId
          ? and(
              eq(historicalOutcome.tenantId, tenantId),
              eq(historicalOutcome.plantId, plantId),
              eq(historicalOutcome.resourceId, resourceId),
            )
          : and(eq(historicalOutcome.tenantId, tenantId), eq(historicalOutcome.plantId, plantId)),
      )
      .orderBy(asc(historicalOutcome.periodStart))
  }

  async insertHistoricalOutcomes(rows: NewHistoricalOutcome[]): Promise<void> {
    if (rows.length > 0) await this.db.insert(historicalOutcome).values(rows)
  }

  /** Dev scenario launcher — persistently change an active demand line's quantity. */
  async updateDemandQty(tenantId: string, demandLineId: string, requiredQty: number): Promise<DemandInput | undefined> {
    const [row] = await this.db
      .update(demandInput)
      .set({ requiredQty })
      .where(and(eq(demandInput.tenantId, tenantId), eq(demandInput.demandLineId, demandLineId), eq(demandInput.isActive, true)))
      .returning()
    return row
  }

  // --- phase 6: conversations (persistent, named, auditable) -----------------
  async createConversation(data: NewConversation): Promise<Conversation> {
    const [row] = await this.db.insert(conversation).values(data).returning()
    return row!
  }

  findConversation(tenantId: string, id: string): Promise<Conversation | undefined> {
    return this.db.query.conversation.findFirst({
      where: and(eq(conversation.tenantId, tenantId), eq(conversation.id, id)),
    })
  }

  listConversations(tenantId: string): Promise<Conversation[]> {
    return this.db
      .select()
      .from(conversation)
      .where(eq(conversation.tenantId, tenantId))
      .orderBy(desc(conversation.createdAt))
  }

  async renameConversation(tenantId: string, id: string, name: string): Promise<Conversation | undefined> {
    const [row] = await this.db
      .update(conversation)
      .set({ name })
      .where(and(eq(conversation.tenantId, tenantId), eq(conversation.id, id)))
      .returning()
    return row
  }

  async createTurn(data: NewConversationTurn): Promise<ConversationTurn> {
    const [row] = await this.db.insert(conversationTurn).values(data).returning()
    return row!
  }

  /** A conversation's turns, oldest first (ULID sorts chronologically) — history + reference resolution. */
  listTurns(conversationId: string): Promise<ConversationTurn[]> {
    return this.db
      .select()
      .from(conversationTurn)
      .where(eq(conversationTurn.conversationId, conversationId))
      .orderBy(asc(conversationTurn.id))
  }
}
