import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { ORG_DB, type OrgDatabase } from './org.db'
import {
  calendar,
  customer,
  line,
  plant,
  plantGroup,
  plantGroupMember,
  program,
  type Calendar,
  type Customer,
  type Line,
  type NewCalendar,
  type NewCustomer,
  type NewLine,
  type NewPlant,
  type NewPlantGroup,
  type NewProgram,
  type Plant,
  type PlantGroup,
  type Program,
} from './schema'

/**
 * All Drizzle queries for the org module. Every method is tenant-scoped; this
 * repository's `db` is scoped to ONLY org tables (O2).
 */
@Injectable()
export class OrgRepository {
  constructor(@Inject(ORG_DB) private readonly db: OrgDatabase) {}

  // --- plant -----------------------------------------------------------------
  listPlants(tenantId: string): Promise<Plant[]> {
    return this.db.select().from(plant).where(eq(plant.tenantId, tenantId)).orderBy(asc(plant.name))
  }

  findPlant(tenantId: string, id: string): Promise<Plant | undefined> {
    return this.db.query.plant.findFirst({ where: and(eq(plant.tenantId, tenantId), eq(plant.id, id)) })
  }

  /** Returns the ids (of the given set) that exist as ACTIVE plants in the tenant (O4). */
  async activePlantIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: plant.id })
      .from(plant)
      .where(and(eq(plant.tenantId, tenantId), eq(plant.status, 'active'), inArray(plant.id, ids)))
    return rows.map((r) => r.id)
  }

  async createPlant(data: NewPlant): Promise<Plant> {
    const [row] = await this.db.insert(plant).values(data).returning()
    return row!
  }

  async updatePlant(tenantId: string, id: string, patch: Partial<NewPlant>): Promise<Plant | undefined> {
    const [row] = await this.db
      .update(plant)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(plant.tenantId, tenantId), eq(plant.id, id)))
      .returning()
    return row
  }

  // --- line (S0a) ------------------------------------------------------------
  listLines(tenantId: string): Promise<Line[]> {
    return this.db.select().from(line).where(eq(line.tenantId, tenantId)).orderBy(asc(line.name))
  }

  findLine(tenantId: string, id: string): Promise<Line | undefined> {
    return this.db.query.line.findFirst({ where: and(eq(line.tenantId, tenantId), eq(line.id, id)) })
  }

  /** Returns the ids (of the given set) that exist as ACTIVE lines in the tenant (O4). */
  async activeLineIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: line.id })
      .from(line)
      .where(and(eq(line.tenantId, tenantId), eq(line.status, 'active'), inArray(line.id, ids)))
    return rows.map((r) => r.id)
  }

  async createLine(data: NewLine): Promise<Line> {
    const [row] = await this.db.insert(line).values(data).returning()
    return row!
  }

  async updateLine(tenantId: string, id: string, patch: Partial<NewLine>): Promise<Line | undefined> {
    const [row] = await this.db
      .update(line)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(line.tenantId, tenantId), eq(line.id, id)))
      .returning()
    return row
  }

  // --- plant group -----------------------------------------------------------
  listPlantGroups(tenantId: string): Promise<PlantGroup[]> {
    return this.db
      .select()
      .from(plantGroup)
      .where(eq(plantGroup.tenantId, tenantId))
      .orderBy(asc(plantGroup.name))
  }

  findPlantGroup(tenantId: string, id: string): Promise<PlantGroup | undefined> {
    return this.db.query.plantGroup.findFirst({
      where: and(eq(plantGroup.tenantId, tenantId), eq(plantGroup.id, id)),
    })
  }

  async groupIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: plantGroup.id })
      .from(plantGroup)
      .where(and(eq(plantGroup.tenantId, tenantId), inArray(plantGroup.id, ids)))
    return rows.map((r) => r.id)
  }

  async memberPlantIds(plantGroupId: string): Promise<string[]> {
    const rows = await this.db
      .select({ plantId: plantGroupMember.plantId })
      .from(plantGroupMember)
      .where(eq(plantGroupMember.plantGroupId, plantGroupId))
    return rows.map((r) => r.plantId)
  }

  async createPlantGroup(data: NewPlantGroup, memberPlantIds: string[]): Promise<PlantGroup> {
    const [row] = await this.db.insert(plantGroup).values(data).returning()
    await this.replaceMembers(row!.tenantId, row!.id, memberPlantIds)
    return row!
  }

  async updatePlantGroup(
    tenantId: string,
    id: string,
    patch: Partial<NewPlantGroup>,
    memberPlantIds?: string[],
  ): Promise<PlantGroup | undefined> {
    const [row] = await this.db
      .update(plantGroup)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(plantGroup.tenantId, tenantId), eq(plantGroup.id, id)))
      .returning()
    if (row && memberPlantIds) await this.replaceMembers(tenantId, id, memberPlantIds)
    return row
  }

  private async replaceMembers(tenantId: string, groupId: string, plantIds: string[]): Promise<void> {
    await this.db.delete(plantGroupMember).where(eq(plantGroupMember.plantGroupId, groupId))
    if (plantIds.length === 0) return
    await this.db
      .insert(plantGroupMember)
      .values(plantIds.map((plantId) => ({ tenantId, plantGroupId: groupId, plantId })))
  }

  // --- customer / program ----------------------------------------------------
  listCustomers(tenantId: string): Promise<Customer[]> {
    return this.db
      .select()
      .from(customer)
      .where(eq(customer.tenantId, tenantId))
      .orderBy(asc(customer.name))
  }

  findCustomer(tenantId: string, id: string): Promise<Customer | undefined> {
    return this.db.query.customer.findFirst({
      where: and(eq(customer.tenantId, tenantId), eq(customer.id, id)),
    })
  }

  async createCustomer(data: NewCustomer): Promise<Customer> {
    const [row] = await this.db.insert(customer).values(data).returning()
    return row!
  }

  async updateCustomer(tenantId: string, id: string, patch: Partial<NewCustomer>): Promise<Customer | undefined> {
    const [row] = await this.db
      .update(customer)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(customer.tenantId, tenantId), eq(customer.id, id)))
      .returning()
    return row
  }

  listPrograms(tenantId: string): Promise<Program[]> {
    return this.db.select().from(program).where(eq(program.tenantId, tenantId)).orderBy(asc(program.name))
  }

  findProgram(tenantId: string, id: string): Promise<Program | undefined> {
    return this.db.query.program.findFirst({
      where: and(eq(program.tenantId, tenantId), eq(program.id, id)),
    })
  }

  async createProgram(data: NewProgram): Promise<Program> {
    const [row] = await this.db.insert(program).values(data).returning()
    return row!
  }

  async updateProgram(tenantId: string, id: string, patch: Partial<NewProgram>): Promise<Program | undefined> {
    const [row] = await this.db
      .update(program)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(program.tenantId, tenantId), eq(program.id, id)))
      .returning()
    return row
  }

  // --- calendar --------------------------------------------------------------
  listCalendars(tenantId: string): Promise<Calendar[]> {
    return this.db
      .select()
      .from(calendar)
      .where(eq(calendar.tenantId, tenantId))
      .orderBy(asc(calendar.name))
  }

  findCalendar(tenantId: string, id: string): Promise<Calendar | undefined> {
    return this.db.query.calendar.findFirst({
      where: and(eq(calendar.tenantId, tenantId), eq(calendar.id, id)),
    })
  }

  /** Returns the ids (of the given set) that exist as calendars in the tenant (O4). */
  async calendarIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: calendar.id })
      .from(calendar)
      .where(and(eq(calendar.tenantId, tenantId), inArray(calendar.id, ids)))
    return rows.map((r) => r.id)
  }

  /** Returns the ids (of the given set) that exist as customers in the tenant (O4, `org.read 1.2`). */
  async customerIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.tenantId, tenantId), inArray(customer.id, ids)))
    return rows.map((r) => r.id)
  }

  /** Returns the ids (of the given set) that exist as programs in the tenant (O4, `org.read 1.2`). */
  async programIdsIn(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ id: program.id })
      .from(program)
      .where(and(eq(program.tenantId, tenantId), inArray(program.id, ids)))
    return rows.map((r) => r.id)
  }

  async createCalendar(data: NewCalendar): Promise<Calendar> {
    const [row] = await this.db.insert(calendar).values(data).returning()
    return row!
  }

  async updateCalendar(tenantId: string, id: string, patch: Partial<NewCalendar>): Promise<Calendar | undefined> {
    const [row] = await this.db
      .update(calendar)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(calendar.tenantId, tenantId), eq(calendar.id, id)))
      .returning()
    return row
  }
}
