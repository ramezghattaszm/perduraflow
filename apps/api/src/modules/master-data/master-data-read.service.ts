import { Injectable } from '@nestjs/common'
import {
  MASTERDATA_READ_CONTRACT,
  type CertificationDto,
  type MasterDataReadContract,
  type MasterDataRefValidation,
  type OperatorDto,
  type PartDto,
  type ResourceDto,
  type ResourceGroupDto,
  type RoutingDto,
} from '@perduraflow/contracts'
import {
  toCertificationDto,
  toOperatorDto,
  toPartDto,
  toResourceDto,
  toResourceGroupDto,
  toRoutingDto,
} from './master-data.mapper'
import { MasterDataRepository } from './master-data.repository'

/** DI token for the published `masterdata.read 1.0` interface. */
export const MASTERDATA_READ = Symbol('MASTERDATA_READ')

/**
 * In-process implementation of the published `masterdata.read 1.0` contract
 * (api-spec §10.3). This is the surface phase-2 scheduling will bind to — it
 * depends on `MasterDataReadContract` + DTOs from `@perduraflow/contracts`, never
 * on these tables. **No binding resolver is built this phase** (O7): the module
 * only publishes the contract; its first consumer arrives in phase 2. No
 * transport here (O6).
 */
@Injectable()
export class MasterDataReadService implements MasterDataReadContract {
  readonly contract = MASTERDATA_READ_CONTRACT

  constructor(private readonly repo: MasterDataRepository) {}

  /** Lists the tenant's parts. */
  async listParts(tenantId: string): Promise<PartDto[]> {
    return (await this.repo.listParts(tenantId)).map(toPartDto)
  }

  /** Resolves one part in the tenant, or null. */
  async getPart(tenantId: string, id: string): Promise<PartDto | null> {
    const row = await this.repo.findPart(tenantId, id)
    return row ? toPartDto(row) : null
  }

  /** Partitions `ids` into those that resolve to a part in the tenant and those that do not (O4). */
  async validatePartIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation> {
    const valid = await this.repo.partIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /** Resolves one resource in the tenant, or null. */
  async getResource(tenantId: string, id: string): Promise<ResourceDto | null> {
    const row = await this.repo.findResource(tenantId, id)
    return row ? toResourceDto(row) : null
  }

  /** All resources in the tenant (1.1 — board rows / group-member detail). */
  async listResources(tenantId: string): Promise<ResourceDto[]> {
    return (await this.repo.listResources(tenantId)).map(toResourceDto)
  }

  /** Validates resource references (O4) — for phase-2 consumers. */
  async validateResourceIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation> {
    const valid = await this.repo.resourceIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /** Resolves one resource group (with member ids) in the tenant, or null. */
  async getResourceGroup(tenantId: string, id: string): Promise<ResourceGroupDto | null> {
    const row = await this.repo.findResourceGroup(tenantId, id)
    if (!row) return null
    return toResourceGroupDto(row, await this.repo.memberResourceIds(row.id))
  }

  /** Validates resource-group references (O4) — for phase-2 consumers (eligibility). */
  async validateResourceGroupIds(tenantId: string, ids: string[]): Promise<MasterDataRefValidation> {
    const valid = await this.repo.resourceGroupIdsIn(tenantId, ids)
    const validSet = new Set(valid)
    return { valid, invalid: ids.filter((id) => !validSet.has(id)) }
  }

  /** Resolves one routing (with its ordered operations) in the tenant, or null. */
  async getRouting(tenantId: string, id: string): Promise<RoutingDto | null> {
    const row = await this.repo.findRouting(tenantId, id)
    if (!row) return null
    return toRoutingDto(row, await this.repo.operationsFor(row.id))
  }

  /** The active primary routing (with operations) for a part, or null (1.1 — scheduling). */
  async getPrimaryRoutingForPart(tenantId: string, partId: string): Promise<RoutingDto | null> {
    const row = await this.repo.findPrimaryRoutingForPart(tenantId, partId)
    if (!row) return null
    return toRoutingDto(row, await this.repo.operationsFor(row.id))
  }

  /** Lists the tenant's certifications. */
  async listCertifications(tenantId: string): Promise<CertificationDto[]> {
    return (await this.repo.listCertifications(tenantId)).map(toCertificationDto)
  }

  /** Resolves one operator (with held certification ids) in the tenant, or null. */
  async getOperator(tenantId: string, id: string): Promise<OperatorDto | null> {
    const row = await this.repo.findOperator(tenantId, id)
    if (!row) return null
    return toOperatorDto(row, await this.repo.certificationIdsForOperator(id))
  }

  /** All operators with their held certification ids (1.2 — workforce coverage view). */
  async listOperators(tenantId: string): Promise<OperatorDto[]> {
    const rows = await this.repo.listOperators(tenantId)
    return Promise.all(rows.map(async (r) => toOperatorDto(r, await this.repo.certificationIdsForOperator(r.id))))
  }
}
