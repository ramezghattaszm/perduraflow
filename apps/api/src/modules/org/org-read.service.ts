import { Injectable } from '@nestjs/common'
import {
  ORG_READ_CONTRACT,
  type CalendarDto,
  type CustomerDto,
  type LineDto,
  type OrgReadContract,
  type PlantDto,
  type PlantGroupDto,
  type PlantRefValidation,
  type ProgramDto,
} from '@perduraflow/contracts'
import {
  toCalendarDto,
  toCustomerDto,
  toLineDto,
  toPlantDto,
  toPlantGroupDto,
  toProgramDto,
} from './org.mapper'
import { OrgRepository } from './org.repository'

/** DI token for the kernel org-model read interface (`org.read` 1.0). */
export const ORG_READ = Symbol('ORG_READ')

/**
 * In-process implementation of the kernel `org.read` contract (api-spec §4).
 * This is the ONLY surface other modules use to reach org data — they depend on
 * the `OrgReadContract` interface + DTOs from `@perduraflow/contracts`, never on
 * org's tables or repository (O1/O2). No transport here (O6).
 */
@Injectable()
export class OrgReadService implements OrgReadContract {
  readonly contract = ORG_READ_CONTRACT

  constructor(private readonly repo: OrgRepository) {}

  /** Lists all plants in the tenant. */
  async listPlants(tenantId: string): Promise<PlantDto[]> {
    return (await this.repo.listPlants(tenantId)).map(toPlantDto)
  }

  /** Resolves one plant in the tenant, or null. */
  async getPlant(tenantId: string, id: string): Promise<PlantDto | null> {
    const row = await this.repo.findPlant(tenantId, id)
    return row ? toPlantDto(row) : null
  }

  /** Lists all lines in the tenant (S0a). */
  async listLines(tenantId: string): Promise<LineDto[]> {
    return (await this.repo.listLines(tenantId)).map(toLineDto)
  }

  /** Resolves one line in the tenant (with its parent plantId), or null (S0a). */
  async getLine(tenantId: string, id: string): Promise<LineDto | null> {
    const row = await this.repo.findLine(tenantId, id)
    return row ? toLineDto(row) : null
  }

  /** Resolves one plant group (with its member plant ids) in the tenant, or null. */
  async getPlantGroup(tenantId: string, id: string): Promise<PlantGroupDto | null> {
    const row = await this.repo.findPlantGroup(tenantId, id)
    if (!row) return null
    return toPlantGroupDto(row, await this.repo.memberPlantIds(row.id))
  }

  /** Resolves one customer in the tenant, or null. */
  async getCustomer(tenantId: string, id: string): Promise<CustomerDto | null> {
    const row = await this.repo.findCustomer(tenantId, id)
    return row ? toCustomerDto(row) : null
  }

  /** Resolves one program in the tenant, or null. */
  async getProgram(tenantId: string, id: string): Promise<ProgramDto | null> {
    const row = await this.repo.findProgram(tenantId, id)
    return row ? toProgramDto(row) : null
  }

  /** Resolves one calendar in the tenant, or null. */
  async getCalendar(tenantId: string, id: string): Promise<CalendarDto | null> {
    const row = await this.repo.findCalendar(tenantId, id)
    return row ? toCalendarDto(row) : null
  }

  /**
   * Validates cross-module plant references (O4): partitions `ids` into those
   * that resolve to an active plant in the tenant and those that do not. `auth`
   * calls this before persisting a role's `scoped_plant_ids`.
   */
  async validatePlantIds(tenantId: string, ids: string[]): Promise<PlantRefValidation> {
    const valid = await this.repo.activePlantIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /**
   * Validates cross-module line references (O4, `org.read 1.3`): `master-data` calls
   * this before persisting a `resource.line_id`.
   */
  async validateLineIds(tenantId: string, ids: string[]): Promise<PlantRefValidation> {
    const valid = await this.repo.activeLineIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /** Validates cross-module plant-group references (O4). */
  async validatePlantGroupIds(tenantId: string, ids: string[]): Promise<PlantRefValidation> {
    const valid = await this.repo.groupIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /**
   * Validates cross-module calendar references (O4, `org.read 1.1`): `master-data`
   * calls this before persisting a `resource.calendar_id`.
   */
  async validateCalendarIds(tenantId: string, ids: string[]): Promise<PlantRefValidation> {
    const valid = await this.repo.calendarIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /**
   * Validates cross-module customer references (O4, `org.read 1.2`): `master-data`
   * calls this before persisting a part's `customer_id`.
   */
  async validateCustomerIds(tenantId: string, ids: string[]): Promise<PlantRefValidation> {
    const valid = await this.repo.customerIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /**
   * Validates cross-module program references (O4, `org.read 1.2`): `master-data`
   * calls this before persisting a part's `program` ref.
   */
  async validateProgramIds(tenantId: string, ids: string[]): Promise<PlantRefValidation> {
    const valid = await this.repo.programIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }
}
