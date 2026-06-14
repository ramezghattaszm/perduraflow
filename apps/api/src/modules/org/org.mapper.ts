import type {
  CalendarDto,
  CustomerDto,
  PlantDto,
  PlantGroupDto,
  ProgramDto,
} from '@perduraflow/contracts'
import type { Calendar, Customer, Plant, PlantGroup, Program } from './schema'

/** Map an org row to its `org.read` DTO. */
export const toPlantDto = (p: Plant): PlantDto => ({
  id: p.id,
  name: p.name,
  timezone: p.timezone,
  region: p.region,
  location: p.location,
  status: p.status,
})

export const toPlantGroupDto = (g: PlantGroup, memberPlantIds: string[]): PlantGroupDto => ({
  id: g.id,
  name: g.name,
  groupType: g.groupType,
  allowsResourceSharing: g.allowsResourceSharing,
  memberPlantIds,
  isActive: g.isActive,
})

export const toCustomerDto = (c: Customer): CustomerDto => ({
  id: c.id,
  name: c.name,
  firmFenceDays: c.firmFenceDays,
  isActive: c.isActive,
})

export const toProgramDto = (p: Program): ProgramDto => ({
  id: p.id,
  customerId: p.customerId,
  name: p.name,
  firmFenceDays: p.firmFenceDays,
  isActive: p.isActive,
})

export const toCalendarDto = (c: Calendar): CalendarDto => ({
  id: c.id,
  plantId: c.plantId,
  name: c.name,
  shiftPatterns: c.shiftPatterns,
  holidays: c.holidays,
  maintenanceWindows: c.maintenanceWindows,
  isActive: c.isActive,
})
