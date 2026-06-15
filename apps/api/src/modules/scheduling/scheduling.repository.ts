import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq } from 'drizzle-orm'
import { SCHEDULING_DB, type SchedulingDatabase } from './scheduling.db'
import {
  demandInput,
  optimizerRun,
  scheduledOperation,
  scheduleVersion,
  type DemandInput,
  type NewOptimizerRun,
  type NewScheduledOperation,
  type NewScheduleVersion,
  type OptimizerRun,
  type ScheduledOperation,
  type ScheduleVersion,
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
}
