import { HttpStatus, Injectable } from '@nestjs/common'
import type {
  CalendarDto,
  CreateCalendarRequest,
  CreateCustomerRequest,
  CreateLineRequest,
  CreatePlantGroupRequest,
  CreatePlantRequest,
  CreateProgramRequest,
  CustomerDto,
  LineDto,
  PlantDto,
  PlantGroupDto,
  ProgramDto,
  UpdateCalendarRequest,
  UpdateCustomerRequest,
  UpdateLineRequest,
  UpdatePlantGroupRequest,
  UpdatePlantRequest,
  UpdateProgramRequest,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { EventBus } from '../eventbus/event-bus'
import { EVENTS } from '../../events'
import {
  toCalendarDto,
  toCustomerDto,
  toLineDto,
  toPlantDto,
  toPlantGroupDto,
  toProgramDto,
} from './org.mapper'
import { OrgRepository } from './org.repository'

/**
 * Org module domain service — admin CRUD for the kernel organizational model
 * (Plant, Plant group, Customer, Program, Calendar). Every operation is
 * tenant-scoped from the caller's JWT; cross-references (group members, a
 * program's customer, a calendar's plant) are validated within the tenant before
 * write (D45 spirit). Creates publish through the EventBus (O5).
 */
@Injectable()
export class OrgService {
  constructor(
    private readonly repo: OrgRepository,
    private readonly events: EventBus,
  ) {}

  // --- plant -----------------------------------------------------------------
  /** Lists the tenant's plants. */
  async listPlants(tenantId: string): Promise<PlantDto[]> {
    return (await this.repo.listPlants(tenantId)).map(toPlantDto)
  }

  /**
   * Creates a plant. Emits `org.plant.created`.
   * @throws AppException VALIDATION_ERROR - dto failed schema validation (pipe)
   */
  async createPlant(tenantId: string, dto: CreatePlantRequest): Promise<PlantDto> {
    const row = await this.repo.createPlant({ ...dto, tenantId })
    await this.events.publish(EVENTS.PLANT_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toPlantDto(row)
  }

  /**
   * Updates a plant in the tenant.
   * @throws AppException PLANT_NOT_FOUND - no such plant in the tenant
   */
  async updatePlant(tenantId: string, id: string, dto: UpdatePlantRequest): Promise<PlantDto> {
    const row = await this.repo.updatePlant(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Plant not found', ERROR_CODES.PLANT_NOT_FOUND)
    return toPlantDto(row)
  }

  // --- line (S0a) ------------------------------------------------------------
  /** Lists the tenant's lines. */
  async listLines(tenantId: string): Promise<LineDto[]> {
    return (await this.repo.listLines(tenantId)).map(toLineDto)
  }

  /**
   * Creates a line under an existing plant (S0a). The line's `plant_id` is validated
   * against the tenant's plants (O4). Emits `org.line.created`.
   * @throws AppException PLANT_NOT_FOUND - the line's plant did not resolve
   */
  async createLine(tenantId: string, dto: CreateLineRequest): Promise<LineDto> {
    await this.assertPlantsExist(tenantId, [dto.plantId])
    const row = await this.repo.createLine({ ...dto, tenantId })
    await this.events.publish(EVENTS.LINE_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toLineDto(row)
  }

  /**
   * Updates a line in the tenant (S0a). Re-validates `plant_id` when supplied.
   * @throws AppException LINE_NOT_FOUND - no such line in the tenant
   * @throws AppException PLANT_NOT_FOUND - the new plant did not resolve
   */
  async updateLine(tenantId: string, id: string, dto: UpdateLineRequest): Promise<LineDto> {
    if (dto.plantId) await this.assertPlantsExist(tenantId, [dto.plantId])
    const row = await this.repo.updateLine(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Line not found', ERROR_CODES.LINE_NOT_FOUND)
    return toLineDto(row)
  }

  // --- plant group -----------------------------------------------------------
  /** Lists the tenant's plant groups, each with its member plant ids. */
  async listPlantGroups(tenantId: string): Promise<PlantGroupDto[]> {
    const groups = await this.repo.listPlantGroups(tenantId)
    return Promise.all(
      groups.map(async (g) => toPlantGroupDto(g, await this.repo.memberPlantIds(g.id))),
    )
  }

  /**
   * Creates a plant group, validating that every member plant exists in the
   * tenant. Emits `org.plant_group.created`.
   * @throws AppException PLANT_NOT_FOUND - a member plant id did not resolve
   */
  async createPlantGroup(tenantId: string, dto: CreatePlantGroupRequest): Promise<PlantGroupDto> {
    await this.assertPlantsExist(tenantId, dto.memberPlantIds)
    const { memberPlantIds, ...fields } = dto
    const row = await this.repo.createPlantGroup({ ...fields, tenantId }, memberPlantIds)
    await this.events.publish(EVENTS.PLANT_GROUP_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toPlantGroupDto(row, memberPlantIds)
  }

  /**
   * Updates a plant group (and its members when supplied).
   * @throws AppException PLANT_GROUP_NOT_FOUND - no such group in the tenant
   * @throws AppException PLANT_NOT_FOUND - a member plant id did not resolve
   */
  async updatePlantGroup(
    tenantId: string,
    id: string,
    dto: UpdatePlantGroupRequest,
  ): Promise<PlantGroupDto> {
    if (dto.memberPlantIds) await this.assertPlantsExist(tenantId, dto.memberPlantIds)
    const { memberPlantIds, ...fields } = dto
    const row = await this.repo.updatePlantGroup(tenantId, id, fields, memberPlantIds)
    if (!row) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Plant group not found', ERROR_CODES.PLANT_GROUP_NOT_FOUND)
    }
    return toPlantGroupDto(row, await this.repo.memberPlantIds(id))
  }

  // --- customer / program ----------------------------------------------------
  /** Lists the tenant's customers. */
  async listCustomers(tenantId: string): Promise<CustomerDto[]> {
    return (await this.repo.listCustomers(tenantId)).map(toCustomerDto)
  }

  /** Creates a customer. Emits `org.customer.created`. */
  async createCustomer(tenantId: string, dto: CreateCustomerRequest): Promise<CustomerDto> {
    const row = await this.repo.createCustomer({ ...dto, tenantId })
    await this.events.publish(EVENTS.CUSTOMER_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toCustomerDto(row)
  }

  /**
   * Updates a customer in the tenant.
   * @throws AppException CUSTOMER_NOT_FOUND - no such customer in the tenant
   */
  async updateCustomer(tenantId: string, id: string, dto: UpdateCustomerRequest): Promise<CustomerDto> {
    const row = await this.repo.updateCustomer(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Customer not found', ERROR_CODES.CUSTOMER_NOT_FOUND)
    return toCustomerDto(row)
  }

  /** Lists the tenant's programs. */
  async listPrograms(tenantId: string): Promise<ProgramDto[]> {
    return (await this.repo.listPrograms(tenantId)).map(toProgramDto)
  }

  /**
   * Creates a program under an existing customer. Emits `org.program.created`.
   * @throws AppException CUSTOMER_NOT_FOUND - the program's customer did not resolve
   */
  async createProgram(tenantId: string, dto: CreateProgramRequest): Promise<ProgramDto> {
    await this.assertCustomerExists(tenantId, dto.customerId)
    const row = await this.repo.createProgram({ ...dto, tenantId })
    await this.events.publish(EVENTS.PROGRAM_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toProgramDto(row)
  }

  /**
   * Updates a program in the tenant.
   * @throws AppException PROGRAM_NOT_FOUND - no such program in the tenant
   * @throws AppException CUSTOMER_NOT_FOUND - the new customer did not resolve
   */
  async updateProgram(tenantId: string, id: string, dto: UpdateProgramRequest): Promise<ProgramDto> {
    if (dto.customerId) await this.assertCustomerExists(tenantId, dto.customerId)
    const row = await this.repo.updateProgram(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Program not found', ERROR_CODES.PROGRAM_NOT_FOUND)
    return toProgramDto(row)
  }

  // --- calendar --------------------------------------------------------------
  /** Lists the tenant's calendars. */
  async listCalendars(tenantId: string): Promise<CalendarDto[]> {
    return (await this.repo.listCalendars(tenantId)).map(toCalendarDto)
  }

  /**
   * Creates a calendar (optionally plant-scoped). Emits `org.calendar.created`.
   * @throws AppException PLANT_NOT_FOUND - the referenced plant did not resolve
   */
  async createCalendar(tenantId: string, dto: CreateCalendarRequest): Promise<CalendarDto> {
    if (dto.plantId) await this.assertPlantsExist(tenantId, [dto.plantId])
    const row = await this.repo.createCalendar({
      tenantId,
      name: dto.name,
      plantId: dto.plantId,
      shiftPatterns: dto.shiftPatterns ?? [],
      holidays: dto.holidays ?? [],
      workingDays: dto.workingDays ?? [1, 2, 3, 4, 5, 6],
    })
    await this.events.publish(EVENTS.CALENDAR_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toCalendarDto(row)
  }

  /**
   * Updates a calendar in the tenant.
   * @throws AppException CALENDAR_NOT_FOUND - no such calendar in the tenant
   * @throws AppException PLANT_NOT_FOUND - the new plant did not resolve
   */
  async updateCalendar(tenantId: string, id: string, dto: UpdateCalendarRequest): Promise<CalendarDto> {
    if (dto.plantId) await this.assertPlantsExist(tenantId, [dto.plantId])
    const row = await this.repo.updateCalendar(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Calendar not found', ERROR_CODES.CALENDAR_NOT_FOUND)
    return toCalendarDto(row)
  }

  // --- internal validation ---------------------------------------------------
  private async assertPlantsExist(tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const found = await this.repo.activePlantIdsIn(tenantId, ids)
    if (found.length !== new Set(ids).size) {
      throw new AppException(HttpStatus.NOT_FOUND, 'One or more plants not found', ERROR_CODES.PLANT_NOT_FOUND)
    }
  }

  private async assertCustomerExists(tenantId: string, id: string): Promise<void> {
    if (!(await this.repo.findCustomer(tenantId, id))) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Customer not found', ERROR_CODES.CUSTOMER_NOT_FOUND)
    }
  }
}
