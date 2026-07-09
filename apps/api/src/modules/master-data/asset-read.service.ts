import { Injectable } from '@nestjs/common'
import {
  ASSET_READ_CONTRACT,
  type AssetReadContract,
  type CreateToolingAssetRequest,
  type ResourceDowntimeDto,
  type ResourceDto,
  type ResourceGroupDto,
  type ResourceTypeConfigDto,
  type ToolingAssetDto,
  type UpdateToolingAssetRequest,
} from '@perduraflow/contracts'
import { MasterDataReadService } from './master-data-read.service'
import { MasterDataRepository } from './master-data.repository'
import { type ToolingAssetWithChildren, MasterDataService } from './master-data.service'

/** DI token for the published `asset.read 1.0` interface (consumed cross-module + resolved via the O7 binding). */
export const ASSET_READ = Symbol('ASSET_READ')

/**
 * In-process implementation of `asset.read 1.0` (Layer 2 2b, D-L2-3) — the resource surface (moved off
 * `masterdata.read`, delegated to its still-present read impl) + the tooling/asset ops (via
 * {@link MasterDataService} + repo, mapped to DTOs). Registered as the `platform_module` binding counterpart
 * at the composition root (O7). The resource ops are behavior-preserving: they resolve the exact same rows
 * `masterdata.read` did — only the contract handle changed.
 */
@Injectable()
export class AssetReadService implements AssetReadContract {
  readonly contract = ASSET_READ_CONTRACT

  constructor(
    private readonly mdRead: MasterDataReadService,
    private readonly md: MasterDataService,
    private readonly repo: MasterDataRepository,
  ) {}

  // --- resource surface (moved; delegates to the masterdata.read impl, same rows) ---
  getResource(tenantId: string, id: string): Promise<ResourceDto | null> {
    return this.mdRead.getResource(tenantId, id)
  }
  listResources(tenantId: string): Promise<ResourceDto[]> {
    return this.mdRead.listResources(tenantId)
  }
  getResourceGroup(tenantId: string, id: string): Promise<ResourceGroupDto | null> {
    return this.mdRead.getResourceGroup(tenantId, id)
  }
  listResourceTypeConfigs(tenantId: string): Promise<ResourceTypeConfigDto[]> {
    return this.mdRead.listResourceTypeConfigs(tenantId)
  }
  listActiveDowntime(tenantId: string, plantId?: string): Promise<ResourceDowntimeDto[]> {
    return this.mdRead.listActiveDowntime(tenantId, plantId)
  }

  // --- tooling reads ---
  async getToolingAsset(tenantId: string, id: string): Promise<ToolingAssetDto | null> {
    const asset = await this.repo.findToolingAsset(tenantId, id)
    if (!asset) return null
    return this.toDto({ asset, eligibleResourceIds: await this.repo.eligibleResourceIdsFor(id), partNos: await this.repo.partNosForToolingAsset(id) })
  }

  async listToolingAssets(tenantId: string): Promise<ToolingAssetDto[]> {
    return (await this.md.listToolingAssets(tenantId)).map((a) => this.toDto(a))
  }

  async getAssetsForPart(tenantId: string, partNo: string): Promise<ToolingAssetDto[]> {
    const assets = await this.repo.assetsForPart(tenantId, partNo)
    return Promise.all(
      assets.map(async (asset) =>
        this.toDto({ asset, eligibleResourceIds: await this.repo.eligibleResourceIdsFor(asset.id), partNos: await this.repo.partNosForToolingAsset(asset.id) }),
      ),
    )
  }

  // --- tooling admin CRUD ---
  async createToolingAsset(tenantId: string, input: CreateToolingAssetRequest, actor: string): Promise<ToolingAssetDto> {
    return this.toDto(await this.md.createToolingAsset(tenantId, input, actor))
  }
  async updateToolingAsset(tenantId: string, id: string, input: UpdateToolingAssetRequest, actor: string): Promise<ToolingAssetDto> {
    return this.toDto(await this.md.updateToolingAsset(tenantId, id, input, actor))
  }
  async deactivateToolingAsset(tenantId: string, id: string, actor: string): Promise<ToolingAssetDto> {
    return this.toDto(await this.md.deactivateToolingAsset(tenantId, id, actor))
  }

  // --- in-use probe (config → Master Data, O7) ---
  /** Any active tooling asset of this `assetType` in the tenant? Config's `asset_type` set gates suppression on it. */
  hasActiveToolingAssetOfType(tenantId: string, assetType: string): Promise<boolean> {
    return this.repo.existsActiveToolingAssetOfType(tenantId, assetType)
  }

  private toDto({ asset, eligibleResourceIds, partNos }: ToolingAssetWithChildren): ToolingAssetDto {
    return {
      id: asset.id,
      assetId: asset.assetId,
      assetType: asset.assetType,
      toolFamily: asset.toolFamily,
      plantId: asset.plantId,
      toolLifeUnits: asset.toolLifeUnits,
      toolLifeUom: asset.toolLifeUom,
      singleLocation: asset.singleLocation,
      isActive: asset.isActive,
      eligibleResourceIds,
      partNos,
    }
  }
}
