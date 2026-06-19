import { z } from 'zod'

/**
 * Kernel organizational-model contract (A10/D17). Plant, Plant group, Customer,
 * Program, Calendar are kernel reference data consumed by every module — NOT a
 * replaceable domain module, so this read interface sits behind **no per-tenant
 * binding** (api-spec §0). It still crosses a real boundary: consumers (e.g.
 * `auth` validating a role's scoped plant IDs — O4) depend on the `org.read`
 * interface and DTOs here, never on the org module's tables.
 *
 * Carries an `id + version` from day one (SKIP-21). The full A12 registry,
 * MAJOR.MINOR wire negotiation, and open/closed enum annotations are deferred.
 */
// `1.1` (phase 1, additive MINOR — api-spec §10.3): adds `validateCalendarIds`
// and a `priority` field on Customer/Program. Every `1.0` consumer keeps
// compiling (the phase-0 `auth` consumer is unaffected — A12 must-ignore).
export const ORG_READ_CONTRACT = { id: 'org.read', version: '1.1' } as const

// --- enums -------------------------------------------------------------------

export const plantStatusSchema = z.enum(['active', 'inactive'])
export type PlantStatus = z.infer<typeof plantStatusSchema>

/** D49: `cluster` = resource-sharing candidate; `division`/`region` = reporting/scope. */
export const plantGroupTypeSchema = z.enum(['cluster', 'division', 'region', 'custom'])
export type PlantGroupType = z.infer<typeof plantGroupTypeSchema>

/** Customer/program allocation tier (phase 1, MD15). Simple ordinal tier, not a commercial engine. */
export const orgPrioritySchema = z.enum(['standard', 'high', 'critical'])
export type OrgPriority = z.infer<typeof orgPrioritySchema>

// --- DTOs (the shapes org.read returns) --------------------------------------

export interface PlantDto {
  id: string
  name: string
  timezone: string
  region: string | null
  location: string | null
  status: PlantStatus
}

export interface PlantGroupDto {
  id: string
  name: string
  groupType: PlantGroupType
  allowsResourceSharing: boolean
  memberPlantIds: string[]
  /** Soft-delete flag (deactivate, never hard delete). */
  isActive: boolean
}

export interface CustomerDto {
  id: string
  name: string
  /** Default firm-fence horizon in days (D23); program overrides it. */
  firmFenceDays: number | null
  /** Default allocation tier for this customer's orders (phase 1, MD15). */
  priority: OrgPriority
  /** Soft-delete flag. */
  isActive: boolean
}

export interface ProgramDto {
  id: string
  customerId: string
  name: string
  /** Overrides the customer default firm fence when set (D23). */
  firmFenceDays: number | null
  /** Overrides the customer default priority when set; null = inherit (phase 1, MD15). */
  priority: OrgPriority | null
  /** Soft-delete flag. */
  isActive: boolean
}

export interface CalendarDto {
  id: string
  /** Plant-level if null (tenant-level otherwise). Plain text ref (no cross-schema FK). */
  plantId: string | null
  name: string
  shiftPatterns: unknown
  holidays: unknown
  /** Plant-level in phase 0; no resource_id reference yet (SKIP-52). */
  maintenanceWindows: unknown
  /** UTC weekdays the calendar operates (0=Sun … 6=Sat); default Mon–Sat (D-shift). */
  workingDays: unknown
  /** Soft-delete flag. */
  isActive: boolean
}

/** Result of validating cross-module plant references (O4). */
export interface PlantRefValidation {
  valid: string[]
  invalid: string[]
}

/**
 * The kernel org-model read interface (`org.read` 1.0). Consumers depend on this
 * type; the org module provides the in-process implementation. No transport in
 * the interface (O6) — an HTTP/Kafka adapter later changes nothing here.
 */
export interface OrgReadContract {
  readonly contract: typeof ORG_READ_CONTRACT
  listPlants(tenantId: string): Promise<PlantDto[]>
  getPlant(tenantId: string, id: string): Promise<PlantDto | null>
  getPlantGroup(tenantId: string, id: string): Promise<PlantGroupDto | null>
  getCustomer(tenantId: string, id: string): Promise<CustomerDto | null>
  getProgram(tenantId: string, id: string): Promise<ProgramDto | null>
  getCalendar(tenantId: string, id: string): Promise<CalendarDto | null>
  /** Validates that every id resolves to an active plant in the tenant (O4). */
  validatePlantIds(tenantId: string, ids: string[]): Promise<PlantRefValidation>
  /** Validates that every id resolves to a plant group in the tenant (O4). */
  validatePlantGroupIds(tenantId: string, ids: string[]): Promise<PlantRefValidation>
  /**
   * Validates that every id resolves to a calendar in the tenant (O4). Added in
   * `org.read 1.1` so `master-data` can validate `resource.calendar_id` at write.
   */
  validateCalendarIds(tenantId: string, ids: string[]): Promise<PlantRefValidation>
}

// --- admin CRUD request schemas (org admin screens) --------------------------

export const createPlantSchema = z
  .object({
    name: z.string().min(1).max(160),
    timezone: z.string().min(1).max(64),
    region: z.string().max(160).nullable().default(null),
    location: z.string().max(160).nullable().default(null),
    status: plantStatusSchema.default('active'),
  })
  .strict()
export type CreatePlantRequest = z.infer<typeof createPlantSchema>
export const updatePlantSchema = createPlantSchema.partial().strict()
export type UpdatePlantRequest = z.infer<typeof updatePlantSchema>

export const createPlantGroupSchema = z
  .object({
    name: z.string().min(1).max(160),
    groupType: plantGroupTypeSchema,
    allowsResourceSharing: z.boolean().default(false),
    memberPlantIds: z.array(z.string()).default([]),
  })
  .strict()
export type CreatePlantGroupRequest = z.infer<typeof createPlantGroupSchema>
export const updatePlantGroupSchema = createPlantGroupSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdatePlantGroupRequest = z.infer<typeof updatePlantGroupSchema>

export const createCustomerSchema = z
  .object({
    name: z.string().min(1).max(160),
    firmFenceDays: z.number().int().min(0).max(3650).nullable().default(null),
    priority: orgPrioritySchema.default('standard'),
  })
  .strict()
export type CreateCustomerRequest = z.infer<typeof createCustomerSchema>
export const updateCustomerSchema = createCustomerSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdateCustomerRequest = z.infer<typeof updateCustomerSchema>

export const createProgramSchema = z
  .object({
    customerId: z.string().min(1),
    name: z.string().min(1).max(160),
    firmFenceDays: z.number().int().min(0).max(3650).nullable().default(null),
    priority: orgPrioritySchema.nullable().default(null),
  })
  .strict()
export type CreateProgramRequest = z.infer<typeof createProgramSchema>
export const updateProgramSchema = createProgramSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdateProgramRequest = z.infer<typeof updateProgramSchema>

export const createCalendarSchema = z
  .object({
    name: z.string().min(1).max(160),
    plantId: z.string().nullable().default(null),
    shiftPatterns: z.unknown().default([]),
    holidays: z.unknown().default([]),
    maintenanceWindows: z.unknown().default([]),
    // UTC weekdays the calendar operates (0=Sun … 6=Sat); default Mon–Sat (D-shift).
    workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  })
  .strict()
export type CreateCalendarRequest = z.infer<typeof createCalendarSchema>
export const updateCalendarSchema = createCalendarSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdateCalendarRequest = z.infer<typeof updateCalendarSchema>
