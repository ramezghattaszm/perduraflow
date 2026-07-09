import { z } from 'zod'
import type { ResourceDowntimeDto, ResourceDto, ResourceGroupDto, ResourceTypeConfigDto } from './masterdata'

/**
 * Asset read contract (`asset.read`) — the resource + tooling/asset surface (Layer 2 2b, D-L2-3). Owns the
 * NEW tooling-asset ops AND the resource/resource-group/resource-type/downtime ops **moved off**
 * `masterdata.read` (which keeps them deprecated-not-removed for A12 must-ignore). `masterdata.read` stays
 * the PART contract at 1.5 — its binding id is load-bearing, so no rename. The two dead resource validators
 * (`validateResourceIds`/`validateResourceGroupIds`) are dropped, not moved.
 *
 * `resource_type_config` storage is untouched (still a flat master-data table, reconcile-later) — only its
 * contract EXPOSURE moves here. Consumed cross-module through the O7 binding, like `masterdata.read`.
 */
export const ASSET_READ_CONTRACT = { id: 'asset.read', version: '1.0' } as const

/** A resolved tooling asset (Pattern B) + its eligibility (resources it runs on) + the parts it produces. */
export interface ToolingAssetDto {
  id: string
  assetId: string
  assetType: string
  toolFamily: string | null
  plantId: string
  /** Tool-life budget as an exact decimal string (numeric), or null. */
  toolLifeUnits: string | null
  toolLifeUom: string | null
  singleLocation: boolean
  isActive: boolean
  /** The resources this tool is eligible to run on (eligibility). */
  eligibleResourceIds: string[]
  /** The parts this tool produces. */
  partNos: string[]
}

/**
 * Published `asset.read 1.0` — resource + tooling reads and the tooling admin CRUD, in-process. Registered
 * as the `platform_module` binding counterpart at the composition root (O7), resolved like `masterdata.read`.
 * The `create/update/deactivate` ops are native-SoR writes — the transport that exposes them enforces
 * master-data-admin authorization (ConfigureGuard) and records the `actor` on the audit trail.
 */
export interface AssetReadContract {
  readonly contract: typeof ASSET_READ_CONTRACT
  // --- resource surface (moved from masterdata.read) ---
  getResource(tenantId: string, id: string): Promise<ResourceDto | null>
  listResources(tenantId: string): Promise<ResourceDto[]>
  getResourceGroup(tenantId: string, id: string): Promise<ResourceGroupDto | null>
  listResourceTypeConfigs(tenantId: string): Promise<ResourceTypeConfigDto[]>
  listActiveDowntime(tenantId: string, plantId?: string): Promise<ResourceDowntimeDto[]>
  // --- tooling reads ---
  getToolingAsset(tenantId: string, id: string): Promise<ToolingAssetDto | null>
  listToolingAssets(tenantId: string): Promise<ToolingAssetDto[]>
  /** The tooling assets that produce a given part (via the asset↔part map). */
  getAssetsForPart(tenantId: string, partNo: string): Promise<ToolingAssetDto[]>
  // --- tooling admin CRUD (Pattern B, audited) ---
  createToolingAsset(tenantId: string, input: CreateToolingAssetRequest, actor: string): Promise<ToolingAssetDto>
  updateToolingAsset(tenantId: string, id: string, input: UpdateToolingAssetRequest, actor: string): Promise<ToolingAssetDto>
  deactivateToolingAsset(tenantId: string, id: string, actor: string): Promise<ToolingAssetDto>
}

// --- admin CRUD request schemas (tooling screens) ----------------------------

/** A non-negative decimal string (exact; never a JS number) — the factor-as-string discipline (tool life). */
const decimalString = z.string().max(40).regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string')

export const createToolingAssetSchema = z
  .object({
    assetId: z.string().min(1).max(80),
    // Plain text this layer — write-validated against the `asset_type` reference set in 2b.3.
    assetType: z.string().min(1).max(80),
    toolFamily: z.string().max(120).nullable().optional(),
    plantId: z.string().min(1),
    toolLifeUnits: decimalString.nullable().optional(),
    toolLifeUom: z.string().max(16).nullable().optional(),
    singleLocation: z.boolean().optional(),
    eligibleResourceIds: z.array(z.string()).optional(),
    partNos: z.array(z.string()).optional(),
  })
  .strict()
export type CreateToolingAssetRequest = z.infer<typeof createToolingAssetSchema>

/** Update — the business key `asset_id` is not editable; supplied child arrays REPLACE the existing set. */
export const updateToolingAssetSchema = z
  .object({
    assetType: z.string().min(1).max(80).optional(),
    toolFamily: z.string().max(120).nullable().optional(),
    plantId: z.string().min(1).optional(),
    toolLifeUnits: decimalString.nullable().optional(),
    toolLifeUom: z.string().max(16).nullable().optional(),
    singleLocation: z.boolean().optional(),
    isActive: z.boolean().optional(),
    eligibleResourceIds: z.array(z.string()).optional(),
    partNos: z.array(z.string()).optional(),
  })
  .strict()
export type UpdateToolingAssetRequest = z.infer<typeof updateToolingAssetSchema>
