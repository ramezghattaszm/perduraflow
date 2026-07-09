import { z } from 'zod'

/**
 * BOM read contract (`bom.read`) — the published Bill-of-Material surface (Layer 2 2a, D-L2-3). Owns BOM
 * resolution, multi-level explosion, where-used, and integrity, plus the draft-authoring ops
 * (revise/publish). Consumed cross-module through the O7 binding: 2a.5's material gate and net-requirements
 * read `resolveBom`/`explodeBom` here. `masterdata.read` (the part contract) stays separate at 1.5.
 *
 * `qty_per`/`scrap_pct` cross the wire as their EXACT decimal STRINGS (the Layer-1 factor-as-string
 * boundary) — they feed downstream quantity math where the exact-decimal decision fires. Topology only:
 * explosion/where-used/integrity carry NO plan quantities.
 */
export const BOM_READ_CONTRACT = { id: 'bom.read', version: '1.0' } as const

/** A resolved BOM version's status (draft never resolves through `resolveBom`). */
export const bomStatusSchema = z.enum(['draft', 'published', 'superseded'])
export type BomStatusDto = z.infer<typeof bomStatusSchema>

/** A BOM edge (direct component) — `qtyPer`/`scrapPct` are exact decimal strings. */
export interface BomComponentDto {
  componentPartNo: string
  qtyPer: string
  scrapPct: string | null
}

/** A resolved BOM version + its edges (the version effective as-of; `effectiveFrom` null only for a returned draft). */
export interface ResolvedBomDto {
  parentPartNo: string
  revision: string
  status: BomStatusDto
  effectiveFrom: string | null
  effectiveTo: string | null
  components: BomComponentDto[]
}

/** One node of a BOM explosion — a component occurrence at a depth. Topology only. */
export interface BomExplosionNodeDto {
  partNo: string
  level: number
  parentPartNo: string
  isLeaf: boolean
  cyclic?: boolean
}

/** A detected BOM cycle — the ancestor path that closed on itself. */
export interface BomCycleDto {
  path: string[]
}

/** The multi-level explosion of a BOM (topology + any cycle findings). */
export interface BomExplosionDto {
  parentPartNo: string
  nodes: BomExplosionNodeDto[]
  cycles: BomCycleDto[]
}

/** One where-used occurrence — `partNo` consumes `childPartNo`; `level` steps up (1 = direct parent). */
export interface WhereUsedParentDto {
  partNo: string
  level: number
  childPartNo: string
}

export interface WhereUsedDto {
  componentPartNo: string
  parents: WhereUsedParentDto[]
}

/** A BOM integrity failure kind (D-L2-6). */
export type BomIntegrityKindDto = 'COMPONENT_NOT_FOUND' | 'CYCLE' | 'EFFECTIVITY_INCONSISTENT' | 'MAKE_BUY_INCOHERENT'

/** One structured integrity finding. */
export interface BomIntegrityFindingDto {
  kind: BomIntegrityKindDto
  component?: string
  path?: string[]
  detail: string
}

/** The integrity verdict for a BOM (`ok` + the findings; empty when valid). */
export interface BomIntegrityResultDto {
  parentPartNo: string
  ok: boolean
  findings: BomIntegrityFindingDto[]
}

/**
 * Published `bom.read 1.0` — in-process BOM resolution + draft authoring. Registered as the
 * `platform_module` binding counterpart at the composition root (O7), resolved like `masterdata.read`.
 * Reads are tenant-scoped by the caller; the authoring ops (`reviseBom`/`publishBom`) are native-SoR
 * writes that MUST sit behind master-data-admin authorization when exposed over transport, and record the
 * `actor` on the audit trail.
 */
export interface BomReadContract {
  readonly contract: typeof BOM_READ_CONTRACT
  /** The BOM version effective at `asOf` (default now) + edges, or null (drafts never resolve). */
  resolveBom(tenantId: string, parentPartNo: string, asOf?: string): Promise<ResolvedBomDto | null>
  /** Multi-level explosion as-of (topology; cycle-safe). */
  explodeBom(tenantId: string, parentPartNo: string, asOf?: string): Promise<BomExplosionDto>
  /** Where-used (parents up the structure) as-of. */
  whereUsed(tenantId: string, componentPartNo: string, asOf?: string): Promise<WhereUsedDto>
  /** Integrity findings for the draft (or published-as-of) — the check the publish gate runs, on-demand. */
  validateBomIntegrity(tenantId: string, parentPartNo: string, asOf?: string): Promise<BomIntegrityResultDto>
  /** Author/update the one open draft + its edges (transactional, audited); returns the draft. */
  reviseBom(tenantId: string, parentPartNo: string, input: ReviseBomRequest, actor: string): Promise<ResolvedBomDto>
  /** Publish the open draft as-of `effectiveFrom` (integrity-gated, supersedes prior, audited); returns the published version. */
  publishBom(tenantId: string, parentPartNo: string, effectiveFrom: string, actor: string): Promise<ResolvedBomDto>
}

// --- admin authoring request schemas (BOM draft screens) ---------------------

/** A positive decimal string (exact; never a JS number) — matches the Layer-1 factor-as-string discipline. */
const positiveDecimal = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string')
  .refine((v) => /[1-9]/.test(v), 'must be greater than zero')
const nonNegativeDecimal = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string')

/** One draft edge input — `qtyPer` (positive), `scrapPct` (non-negative, optional). Exact decimal strings. */
export const bomComponentInputSchema = z
  .object({
    componentPartNo: z.string().min(1).max(80),
    qtyPer: positiveDecimal,
    scrapPct: nonNegativeDecimal.nullable().optional(),
  })
  .strict()

/** PUT/POST body — author/replace the draft BOM's edges. `revision` auto-derives when omitted. */
export const reviseBomSchema = z
  .object({
    revision: z.string().min(1).max(40).optional(),
    components: z.array(bomComponentInputSchema),
  })
  .strict()
export type ReviseBomRequest = z.infer<typeof reviseBomSchema>

/** POST body — publish the open draft with an effectivity window start. */
export const publishBomSchema = z.object({ effectiveFrom: z.string().datetime() }).strict()
export type PublishBomRequest = z.infer<typeof publishBomSchema>
