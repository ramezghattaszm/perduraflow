import { z } from 'zod'

/**
 * Master Data module contract (`masterdata.read`, phase 1 — api-spec §10.3). The
 * first **domain** module's published contract: the read interface + DTOs that
 * phase-2 scheduling will bind to, plus the admin CRUD request schemas the
 * master-data screens use. Carries an `id + version` from day one (SKIP-21).
 *
 * **No binding resolver** is built this phase (O7) — `masterdata.read` is only
 * *published*; its first consumer (scheduling) arrives in phase 2. Master Data
 * *consumes* the kernel `org.read 1.1` for plant/calendar validation (O4), never
 * org's tables.
 *
 * Minimal slice (SKIP-02): current-version only (no revision/effectivity SKIP-44),
 * no BOM (SKIP-45), single base UoM no conversion, no tooling/asset domain, the
 * changeover matrix + sequencing rules stay scheduling-owned (SKIP-48).
 */
// `1.1` (phase 2, additive MINOR — api-spec §11.3): adds `listResources` and
// `getPrimaryRoutingForPart` for the scheduling consumer. Every `1.0` consumer
// keeps compiling; bindings pin major `1` so this floats in (A12).
export const MASTERDATA_READ_CONTRACT = { id: 'masterdata.read', version: '1.1' } as const

// --- enums -------------------------------------------------------------------

export const partTypeSchema = z.enum(['finished', 'component', 'raw'])
export type PartType = z.infer<typeof partTypeSchema>

export const resourceTypeSchema = z.enum(['line', 'machine', 'cell', 'work_center'])
export type ResourceType = z.infer<typeof resourceTypeSchema>

/** active/inactive lifecycle for the status-bearing master-data entities (part, resource, routing). */
export const masterDataStatusSchema = z.enum(['active', 'inactive'])
export type MasterDataStatus = z.infer<typeof masterDataStatusSchema>

/**
 * Which **part** physical attribute (MD11/5.6) drives an operation's changeover
 * (AS6) — modeled only this phase; the changeover matrix + sequencing rules stay
 * scheduling-owned and deferred (SKIP-48). `tool_family` is excluded until the
 * tooling/asset domain lands (SKIP-02).
 */
export const changeoverAttributeKeySchema = z.enum(['colour', 'material', 'gauge'])
export type ChangeoverAttributeKey = z.infer<typeof changeoverAttributeKeySchema>

// --- DTOs (the shapes masterdata.read returns) -------------------------------

export interface PartDto {
  id: string
  /** Global-within-tenant business identity (D12). */
  partNo: string
  description: string | null
  partType: PartType
  /** Canonical base UoM; single UoM, no conversion (SKIP-02). */
  uom: string
  /** Physical/descriptive attributes (MD11) — the changeover drivers (AS6). */
  material: string | null
  gauge: string | null
  colour: string | null
  status: MasterDataStatus
}

export interface ResourceDto {
  id: string
  name: string
  resourceType: ResourceType
  /** → kernel Plant, validated via org.read (O4). */
  plantId: string
  /** → kernel Calendar, validated via org.read 1.1 (O4). */
  calendarId: string
  /** Nominal throughput rate (MD5.5; per-op std times are the scheduling baseline). */
  rate: number | null
  rateUom: string | null
  status: MasterDataStatus
}

export interface ResourceGroupDto {
  id: string
  name: string
  /** → kernel Plant, validated via org.read (O4). */
  plantId: string
  /** Interchangeable member resources (intra-module). */
  memberResourceIds: string[]
  isActive: boolean
}

export interface RoutingOperationDto {
  id: string
  opSeq: number
  /** Eligible resource group for this op (5.2, intra-module). */
  resourceGroupId: string
  /** Standalone setup `standard` baseline (D7). */
  stdSetupTime: number
  /** Per-piece cycle `standard` baseline (D7). */
  stdCycleTime: number
  /** Which part attribute drives changeover (AS6); modeled, not sequenced. */
  changeoverAttributeKey: ChangeoverAttributeKey | null
}

export interface RoutingDto {
  id: string
  partId: string
  name: string
  isPrimary: boolean
  status: MasterDataStatus
  /** Ordered operations (by op_seq). */
  operations: RoutingOperationDto[]
}

export interface CertificationDto {
  id: string
  /** Unique-within-tenant taxonomy code (MD15). */
  code: string
  name: string
  description: string | null
  isActive: boolean
}

export interface OperatorDto {
  id: string
  name: string
  /** → kernel Plant, validated via org.read (O4). */
  homePlantId: string
  /** Optional labor rate behind the D57 labor-cost KPI (MD15). */
  laborRate: number | null
  /** Certifications this operator holds (operator_qualification join, MD15). */
  certificationIds: string[]
  isActive: boolean
}

/** Result of validating cross/intra-module references (O4) — mirrors org's shape. */
export interface MasterDataRefValidation {
  valid: string[]
  invalid: string[]
}

/**
 * The published `masterdata.read 1.0` read interface (api-spec §10.3). Phase-2
 * scheduling binds to this; the master-data module provides the in-process impl.
 * No transport in the interface (O6). Reference-validation ops are the O4 seam
 * phase-2 consumers use.
 */
export interface MasterDataReadContract {
  readonly contract: typeof MASTERDATA_READ_CONTRACT
  listParts(tenantId: string): Promise<PartDto[]>
  getPart(tenantId: string, id: string): Promise<PartDto | null>
  validatePartIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation>
  getResource(tenantId: string, id: string): Promise<ResourceDto | null>
  /** All resources in the tenant (added in `1.1` — board rows / group-member detail). */
  listResources(tenantId: string): Promise<ResourceDto[]>
  validateResourceIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation>
  getResourceGroup(tenantId: string, id: string): Promise<ResourceGroupDto | null>
  validateResourceGroupIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation>
  getRouting(tenantId: string, id: string): Promise<RoutingDto | null>
  /** The active primary routing (with operations) for a part, or null (added in `1.1`). */
  getPrimaryRoutingForPart(tenantId: string, partId: string): Promise<RoutingDto | null>
  listCertifications(tenantId: string): Promise<CertificationDto[]>
  getOperator(tenantId: string, id: string): Promise<OperatorDto | null>
}

// --- admin CRUD request schemas (master-data screens) ------------------------

export const createPartSchema = z
  .object({
    partNo: z.string().min(1).max(80),
    description: z.string().max(400).nullable().default(null),
    partType: partTypeSchema,
    uom: z.string().min(1).max(16),
    material: z.string().max(120).nullable().default(null),
    gauge: z.string().max(120).nullable().default(null),
    colour: z.string().max(120).nullable().default(null),
  })
  .strict()
export type CreatePartRequest = z.infer<typeof createPartSchema>
export const updatePartSchema = createPartSchema
  .partial()
  .extend({ status: masterDataStatusSchema.optional() })
  .strict()
export type UpdatePartRequest = z.infer<typeof updatePartSchema>

export const createResourceSchema = z
  .object({
    name: z.string().min(1).max(160),
    resourceType: resourceTypeSchema,
    plantId: z.string().min(1),
    calendarId: z.string().min(1),
    rate: z.number().nonnegative().nullable().default(null),
    rateUom: z.string().max(16).nullable().default(null),
  })
  .strict()
export type CreateResourceRequest = z.infer<typeof createResourceSchema>
export const updateResourceSchema = createResourceSchema
  .partial()
  .extend({ status: masterDataStatusSchema.optional() })
  .strict()
export type UpdateResourceRequest = z.infer<typeof updateResourceSchema>

export const createResourceGroupSchema = z
  .object({
    name: z.string().min(1).max(160),
    plantId: z.string().min(1),
    memberResourceIds: z.array(z.string()).default([]),
  })
  .strict()
export type CreateResourceGroupRequest = z.infer<typeof createResourceGroupSchema>
export const updateResourceGroupSchema = createResourceGroupSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdateResourceGroupRequest = z.infer<typeof updateResourceGroupSchema>

/** One operation row in the routing editor (OperationsEditor); persisted as a replace-all set. */
export const routingOperationInputSchema = z
  .object({
    opSeq: z.number().int().min(1),
    resourceGroupId: z.string().min(1),
    stdSetupTime: z.number().nonnegative(),
    stdCycleTime: z.number().nonnegative(),
    changeoverAttributeKey: changeoverAttributeKeySchema.nullable().default(null),
  })
  .strict()
export type RoutingOperationInput = z.infer<typeof routingOperationInputSchema>

export const createRoutingSchema = z
  .object({
    partId: z.string().min(1),
    name: z.string().min(1).max(160),
    isPrimary: z.boolean().default(true),
    operations: z.array(routingOperationInputSchema).default([]),
  })
  .strict()
export type CreateRoutingRequest = z.infer<typeof createRoutingSchema>
/** Update replaces the operation set wholesale when `operations` is supplied (editor save). */
export const updateRoutingSchema = createRoutingSchema
  .partial()
  .extend({ status: masterDataStatusSchema.optional() })
  .strict()
export type UpdateRoutingRequest = z.infer<typeof updateRoutingSchema>

export const createCertificationSchema = z
  .object({
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(160),
    description: z.string().max(400).nullable().default(null),
  })
  .strict()
export type CreateCertificationRequest = z.infer<typeof createCertificationSchema>
export const updateCertificationSchema = createCertificationSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdateCertificationRequest = z.infer<typeof updateCertificationSchema>

export const createOperatorSchema = z
  .object({
    name: z.string().min(1).max(160),
    homePlantId: z.string().min(1),
    laborRate: z.number().nonnegative().nullable().default(null),
  })
  .strict()
export type CreateOperatorRequest = z.infer<typeof createOperatorSchema>
export const updateOperatorSchema = createOperatorSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdateOperatorRequest = z.infer<typeof updateOperatorSchema>

/** Toggle one operator×certification cell from the QualificationMatrix screen (FS6). */
export const setOperatorQualificationSchema = z
  .object({
    certificationId: z.string().min(1),
    qualified: z.boolean(),
  })
  .strict()
export type SetOperatorQualificationRequest = z.infer<typeof setOperatorQualificationSchema>
