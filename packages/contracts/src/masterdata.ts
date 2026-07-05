import { z } from 'zod'

/**
 * Master Data module contract (`masterdata.read`, phase 1 — api-spec §10.3). The
 * first **domain** module's published contract: the read interface + DTOs that
 * phase-2 scheduling will bind to, plus the admin CRUD request schemas the
 * master-data screens use. Carries an `id + version` from day one (SKIP-21).
 *
 * The per-tenant **binding resolver IS built** (`binding/binding.resolver.ts`, O7);
 * scheduling consumes this contract through `bindings.resolve(MASTERDATA_READ_CONTRACT)`,
 * and the read impl is registered as the `platform_module` counterpart at the composition
 * root. Master Data *consumes* the kernel `org.read 1.1` for plant/calendar validation (O4),
 * never org's tables.
 *
 * Slice: single base UoM no conversion (SKIP-02), no BOM (SKIP-45), no tooling/asset domain,
 * the changeover matrix + sequencing rules stay scheduling-owned (SKIP-48). **Layer 0 adds
 * effectivity + revision (Pattern A) for `part`/`routing`** — resolve-by-`part_no` as-of a date
 * (`resolvePart`/`resolveRouting`) and transactional `revise*`; id-based reads are deprecated
 * (D-L0-4), retained for A12 must-ignore until a future MAJOR.
 */
// `1.2` (phase 3, additive MINOR — api-spec §12.9): adds Tier-B **cost rates** to
// `ResourceDto` (`runCostPerHour`, `setupCost`, `overheadPerUnit`) — Master-Data-
// owned reference data; the cost *calculation* lives in scheduling. `1.1` added
// `listResources` / `getPrimaryRoutingForPart`. Every prior consumer keeps
// compiling; bindings pin major `1` so this floats in (A12).
// `1.3` (additive MINOR): adds `listActiveDowntime` + the `ResourceDowntimeDto` —
// per-resource time-boxed closures (line-down / maintenance) the calendar-aware
// sequencer subtracts from capacity. Every prior consumer keeps compiling; bindings
// pin major `1` so this floats in (A12).
// `1.4` (Layer 0, additive MINOR): adds effectivity + revision (Pattern A) for part/routing —
// `resolvePart`/`resolveRouting`/`resolvePartVersions` (resolve-by-part_no as-of a date) +
// transactional `revisePart`/`reviseRouting`, and `PartVersionDto`/`RoutingVersionDto`. The
// id-based `getPart`/`getRouting`/`getPrimaryRoutingForPart` are deprecated but retained
// (D-L0-4, A12 must-ignore). `org.read` untouched (still 1.1).
export const MASTERDATA_READ_CONTRACT = { id: 'masterdata.read', version: '1.4' } as const

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

/**
 * Why a resource is down for a time-boxed window: an **unplanned** `line_down`
 * (a breakdown/outage) or a **planned** `maintenance` window. Both are the same
 * closure mechanism (subtracted from available capacity); the kind drives copy and
 * the `planned` flag. Distinct from `resource.status='inactive'` (permanent removal).
 */
export const resourceDowntimeKindSchema = z.enum(['line_down', 'maintenance'])
export type ResourceDowntimeKind = z.infer<typeof resourceDowntimeKindSchema>

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
  /** Tier-B cost rates (1.2) — Master-Data-owned; scheduling computes cost/unit from these. */
  runCostPerHour: number | null
  setupCost: number | null
  overheadPerUnit: number | null
  /** Per-resource overtime-cap override (min/day); null → inherit the resource-type default. */
  otCapMinutes: number | null
  status: MasterDataStatus
}

/**
 * A per-resource time-boxed closure (line-down / maintenance). `from`/`to` are ISO
 * datetimes for `[from, to)`; the sequencer subtracts the window from available
 * capacity so ops displace around it. "In effect at now" = `isActive && from ≤ now < to`.
 */
export interface ResourceDowntimeDto {
  id: string
  resourceId: string
  /** → kernel Plant (denormalized for plant-scoped solve reads). */
  plantId: string
  kind: ResourceDowntimeKind
  /** Planned (maintenance) vs unplanned (line-down breakdown). */
  planned: boolean
  /** ISO datetime — window start (inclusive). */
  from: string
  /** ISO datetime — window end (exclusive). */
  to: string
  reason: string | null
  /** Soft-delete flag (`false` = retracted record); NOT the same as the window being over. */
  isActive: boolean
}

/**
 * Resource-type shift defaults (D-shift) — drives the calendar-aware sequencer: whether ops
 * on the type are interruptible (`splittable`) and the default overtime cap (min/day).
 */
export interface ResourceTypeConfigDto {
  resourceType: ResourceType
  splittable: boolean
  otCapMinutes: number
  /** Minimum batch / run-length floor (C4): the sequencer won't run an op below this qty. 0 = no floor. */
  minBatchQty: number
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
  /** The part's durable business key (Pattern A resolve-by-part_no; replaced the dropped `partId`). */
  partNo: string
  name: string
  isPrimary: boolean
  status: MasterDataStatus
  /** Ordered operations (by op_seq). */
  operations: RoutingOperationDto[]
}

/**
 * A resolved **part version** (Layer 0 Pattern A, `1.4`). `PartDto` fields for the resolved
 * revision plus its effectivity window. `id` is the per-version row id; the durable identity
 * is `partNo`. `effectiveFrom`/`effectiveTo` are ISO datetimes; `effectiveTo === null` = the
 * open/current version. Window is half-open `[effectiveFrom, effectiveTo)`.
 */
export interface PartVersionDto extends PartDto {
  revision: string
  effectiveFrom: string
  effectiveTo: string | null
}

/**
 * A resolved **routing version** (Layer 0 Pattern A, `1.4`) with its operations. Carries the
 * denormalized `partNo` (the resolve-by business key) alongside the version window. `effectiveTo
 * === null` = open/current. Window is half-open `[effectiveFrom, effectiveTo)`.
 */
export interface RoutingVersionDto extends RoutingDto {
  revision: string
  effectiveFrom: string
  effectiveTo: string | null
}

export interface CertificationDto {
  id: string
  /** Unique-within-tenant taxonomy code (MD15). */
  code: string
  name: string
  description: string | null
  isActive: boolean
}

/**
 * Why an operator is absent next shift (drives OT call-in eligibility, D54): `not_scheduled` is
 * off-shift and freely callable; `vacation` is callable but TENTATIVE (flag it, confirm first);
 * `sick` is never called in. `null` when the operator is present (`available = true`).
 */
export const operatorAbsenceReasonSchema = z.enum(['not_scheduled', 'sick', 'vacation'])
export type OperatorAbsenceReason = z.infer<typeof operatorAbsenceReasonSchema>

export interface OperatorDto {
  id: string
  name: string
  /** → kernel Plant, validated via org.read (O4). */
  homePlantId: string
  /** Optional labor rate behind the D57 labor-cost KPI (MD15). */
  laborRate: number | null
  /**
   * Performance / efficiency rating (C5) — "percent of standard": 1.0 = standard, >1.0 faster,
   * <1.0 slower. Stored as a ratio (0.5), shown as a percent (50%). The scheduler divides RUN
   * time by it (effectiveCycle = baseCycle / performanceFactor). Higher = better; do NOT invert.
   */
  performanceFactor: number
  /** Present next shift (workforce coverage; `false` = OUT). Seeded/D35 (1.2). */
  available: boolean
  /** Why absent when `available = false` (drives call-in eligibility); `null` when present. */
  absenceReason: OperatorAbsenceReason | null
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
  /**
   * @deprecated (Layer 0, D-L0-4) Resolve by business key + as-of instead: `resolvePart(tenantId,
   * partNo, asOf)`. A part `id` is a per-version row id; holding one pins a single revision. Retained
   * for A12 must-ignore; removed in a future MAJOR once all consumers migrate (Commit 6).
   */
  getPart(tenantId: string, id: string): Promise<PartDto | null>
  /** Resolves the part version effective at `asOf` (default now) by business key `partNo`, or null (`1.4`). */
  resolvePart(tenantId: string, partNo: string, asOf?: string): Promise<PartVersionDto | null>
  /**
   * Reads ONE EXACT part version by its row id (`1.4`, non-deprecated). Legitimate for FROZEN SNAPSHOTS —
   * a `scheduled_operation.part_id` / `execution_actual.part_id` records the precise version scheduled/ran,
   * and reconstructing it means reading that exact version, not resolving the current one. (Contrast the
   * deprecated `getPart` live-lookup, which pins a version where a business-key resolve was meant.)
   */
  getPartVersion(tenantId: string, versionId: string): Promise<PartVersionDto | null>
  /** The full revision history for a `partNo`, ordered by `effectiveFrom` (oldest first) (`1.4`). */
  resolvePartVersions(tenantId: string, partNo: string): Promise<PartVersionDto[]>
  /**
   * Creates a new part revision transactionally (`1.4`): closes the current open version's window at
   * `effectiveFrom`, inserts a new open version (`supersedes_id` = prior), and writes audit — all atomic.
   * Native-SoR only; caller must hold `configure`/master-data-admin. `actor` is the JWT user id (or the
   * `'system'` sentinel) recorded on the audit trail.
   */
  revisePart(tenantId: string, partNo: string, input: RevisePartRequest, actor: string): Promise<PartVersionDto>
  validatePartIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation>
  getResource(tenantId: string, id: string): Promise<ResourceDto | null>
  /** All resources in the tenant (added in `1.1` — board rows / group-member detail). */
  listResources(tenantId: string): Promise<ResourceDto[]>
  validateResourceIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation>
  getResourceGroup(tenantId: string, id: string): Promise<ResourceGroupDto | null>
  validateResourceGroupIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation>
  /**
   * @deprecated (Layer 0, D-L0-4) Resolve by business key + as-of instead: `resolveRouting(tenantId,
   * partNo, { name, asOf })`. A routing `id` is a per-version row id. Retained for A12 must-ignore.
   */
  getRouting(tenantId: string, id: string): Promise<RoutingDto | null>
  /**
   * @deprecated (Layer 0, D-L0-4) Use `resolveRouting(tenantId, partNo, { primaryOnly: true, asOf })`.
   * Resolving by a part *version id* pins a revision; the resolve-as-of path follows the business key.
   */
  getPrimaryRoutingForPart(tenantId: string, partId: string): Promise<RoutingDto | null>
  /**
   * Resolves the routing version effective at `asOf` (default now) for a `partNo` (`1.4`), with its
   * operations. `name` selects a specific routing; `primaryOnly` restricts to the primary. Null if none.
   */
  resolveRouting(
    tenantId: string,
    partNo: string,
    opts?: { name?: string; primaryOnly?: boolean; asOf?: string },
  ): Promise<RoutingVersionDto | null>
  /**
   * Creates a new routing revision transactionally (`1.4`): closes the prior open version, inserts a new
   * open version (`supersedes_id` = prior) with its operation rows copied on, and writes audit — all atomic.
   * Native-SoR only; caller must hold `configure`/master-data-admin. `actor` is recorded on the audit trail.
   */
  reviseRouting(tenantId: string, partNo: string, input: ReviseRoutingRequest, actor: string): Promise<RoutingVersionDto>
  listCertifications(tenantId: string): Promise<CertificationDto[]>
  getOperator(tenantId: string, id: string): Promise<OperatorDto | null>
  /** All operators (with held cert ids) — workforce coverage view (added in `1.2`). */
  listOperators(tenantId: string): Promise<OperatorDto[]>
  /** Resource-type shift config (splittable / OT cap) — the calendar-aware sequencer (D-shift). */
  listResourceTypeConfigs(tenantId: string): Promise<ResourceTypeConfigDto[]>
  /**
   * Active resource downtime windows (line-down / maintenance) — `isActive` and not yet
   * fully past (`to > now`), so the set covers both currently-in-effect and future closures.
   * Optionally plant-scoped for the solve. The sequencer subtracts these from capacity (1.3).
   */
  listActiveDowntime(tenantId: string, plantId?: string): Promise<ResourceDowntimeDto[]>
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
  .extend({
    status: masterDataStatusSchema.optional(),
    // Layer 0 (D-L0-7): a Pattern-A edit is a REVISE — it creates a new effectivity-dated version, never
    // an in-place update. `revision`/`effectiveFrom` are optional (UI hedge): the service auto-derives
    // them (next revision label, effective now) when the admin form omits them.
    revision: z.string().min(1).max(40).optional(),
    effectiveFrom: z.string().datetime().optional(),
  })
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
    // Tier-B cost rates (scheduling computes cost/unit from these) + the shift-model
    // per-resource overtime-cap override (min/day; null → inherit the resource-type default).
    runCostPerHour: z.number().nonnegative().nullable().default(null),
    setupCost: z.number().nonnegative().nullable().default(null),
    overheadPerUnit: z.number().nonnegative().nullable().default(null),
    otCapMinutes: z.number().int().nonnegative().nullable().default(null),
  })
  .strict()
export type CreateResourceRequest = z.infer<typeof createResourceSchema>
export const updateResourceSchema = createResourceSchema
  .partial()
  .extend({ status: masterDataStatusSchema.optional() })
  .strict()
export type UpdateResourceRequest = z.infer<typeof updateResourceSchema>

/**
 * Open a resource downtime window. `plantId` is derived server-side from the resource;
 * `createdBy` from the JWT. The service enforces `to > from`. Used by the dev simulator
 * (line-down) and any maintenance-scheduling surface.
 */
export const createResourceDowntimeSchema = z
  .object({
    resourceId: z.string().min(1),
    kind: resourceDowntimeKindSchema.default('line_down'),
    planned: z.boolean().default(false),
    from: z.string().datetime(),
    to: z.string().datetime(),
    reason: z.string().max(400).nullable().default(null),
  })
  .strict()
export type CreateResourceDowntimeRequest = z.infer<typeof createResourceDowntimeSchema>

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
    partNo: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    isPrimary: z.boolean().default(true),
    operations: z.array(routingOperationInputSchema).default([]),
  })
  .strict()
export type CreateRoutingRequest = z.infer<typeof createRoutingSchema>
/** Update replaces the operation set wholesale when `operations` is supplied (editor save). */
export const updateRoutingSchema = createRoutingSchema
  .partial()
  .extend({
    status: masterDataStatusSchema.optional(),
    // Layer 0 (D-L0-7): a routing edit is a REVISE (new version). Optional revise inputs (UI hedge).
    revision: z.string().min(1).max(40).optional(),
    effectiveFrom: z.string().datetime().optional(),
  })
  .strict()
export type UpdateRoutingRequest = z.infer<typeof updateRoutingSchema>

// --- revise (Layer 0 Pattern A — new version, prior window closed, atomic) ---------

/** Attributes carried onto a new PART revision. `part_no` is the fixed identity and is not settable here. */
export const partRevisionChangesSchema = z
  .object({
    description: z.string().max(400).nullable(),
    partType: partTypeSchema,
    uom: z.string().min(1).max(16),
    material: z.string().max(120).nullable(),
    gauge: z.string().max(120).nullable(),
    colour: z.string().max(120).nullable(),
    status: masterDataStatusSchema,
  })
  .partial()

export const revisePartSchema = z
  .object({
    /** Engineering revision label for the new version (e.g. 'B'); must differ from the current open one. */
    revision: z.string().min(1).max(40),
    /** ISO datetime the new version becomes effective; must be strictly after the current open version's. */
    effectiveFrom: z.string().datetime(),
    /** ECN/ECR reference recorded on the audit trail. */
    ecnRef: z.string().max(120).nullable().default(null),
    /** Attribute changes for the new version; omitted fields inherit the prior version's values. */
    changes: partRevisionChangesSchema.default({}),
  })
  .strict()
export type RevisePartRequest = z.infer<typeof revisePartSchema>

/** Attributes carried onto a new ROUTING revision; when `operations` is supplied it replaces the op set. */
export const routingRevisionChangesSchema = z
  .object({
    name: z.string().min(1).max(160),
    isPrimary: z.boolean(),
    status: masterDataStatusSchema,
    operations: z.array(routingOperationInputSchema),
  })
  .partial()

export const reviseRoutingSchema = z
  .object({
    revision: z.string().min(1).max(40),
    effectiveFrom: z.string().datetime(),
    ecnRef: z.string().max(120).nullable().default(null),
    /** Selects which routing (by name) to revise; defaults to the part's primary routing. */
    name: z.string().min(1).max(160).optional(),
    changes: routingRevisionChangesSchema.default({}),
  })
  .strict()
export type ReviseRoutingRequest = z.infer<typeof reviseRoutingSchema>

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
    // Efficiency rating (C5); 1.0 = standard, higher = faster. Run-time divisor — never invert.
    performanceFactor: z.number().positive().default(1),
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
