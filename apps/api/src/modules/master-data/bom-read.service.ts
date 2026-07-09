import { Injectable } from '@nestjs/common'
import {
  BOM_READ_CONTRACT,
  type BomExplosionDto,
  type BomIntegrityResultDto,
  type BomReadContract,
  type ResolvedBomDto,
  type ReviseBomRequest,
  type WhereUsedDto,
} from '@perduraflow/contracts'
import { MasterDataRepository } from './master-data.repository'
import { MasterDataResolver } from './master-data.resolver'
import type { Bom, BomComponent } from './schema'

/** DI token for the published `bom.read 1.0` interface (consumed cross-module + resolved via the O7 binding). */
export const BOM_READ = Symbol('BOM_READ')

/**
 * In-process implementation of `bom.read 1.0` (Layer 2 2a) — wraps {@link MasterDataResolver}, mapping its
 * domain rows to the wire DTOs (mirrors how {@link MasterDataReadService} wraps the resolver). Registered
 * as the `platform_module` binding counterpart at the composition root (O7). `qty_per`/`scrap_pct` pass
 * through as their exact decimal strings. The `reviseBom`/`publishBom` authoring ops are native-SoR writes
 * — the transport that exposes them enforces master-data-admin authorization (ConfigureGuard).
 */
@Injectable()
export class BomReadService implements BomReadContract {
  readonly contract = BOM_READ_CONTRACT

  constructor(
    private readonly resolver: MasterDataResolver,
    private readonly repo: MasterDataRepository,
  ) {}

  /** The published BOM version effective as-of + its edges, or null (drafts never resolve). */
  async resolveBom(tenantId: string, parentPartNo: string, asOf?: string): Promise<ResolvedBomDto | null> {
    const resolved = await this.resolver.resolveBom(tenantId, parentPartNo, asOf)
    return resolved ? this.toBomDto(resolved.bom, resolved.components) : null
  }

  /** The multi-level explosion topology as-of (recursive, cycle-safe, derives `level`). */
  explodeBom(tenantId: string, parentPartNo: string, asOf?: string): Promise<BomExplosionDto> {
    return this.resolver.explodeBom(tenantId, parentPartNo, asOf)
  }

  /** The parents that consume a component as-of (structural traversal up). */
  whereUsed(tenantId: string, componentPartNo: string, asOf?: string): Promise<WhereUsedDto> {
    return this.resolver.whereUsed(tenantId, componentPartNo, asOf)
  }

  /** Integrity findings for the draft (or published-as-of): components-exist, acyclic, effectivity, make/buy. */
  validateBomIntegrity(tenantId: string, parentPartNo: string, asOf?: string): Promise<BomIntegrityResultDto> {
    return this.resolver.validateBomIntegrity(tenantId, parentPartNo, asOf)
  }

  /** Author/update the draft; returns the draft + its edges. */
  async reviseBom(tenantId: string, parentPartNo: string, input: ReviseBomRequest, actor: string): Promise<ResolvedBomDto> {
    const draft = await this.resolver.reviseBom(tenantId, parentPartNo, input, actor)
    return this.toBomDto(draft, await this.repo.bomComponentsFor(draft.id))
  }

  /** Publish the open draft; returns the published version + its edges. */
  async publishBom(tenantId: string, parentPartNo: string, effectiveFrom: string, actor: string): Promise<ResolvedBomDto> {
    const published = await this.resolver.publishBom(tenantId, parentPartNo, effectiveFrom, actor)
    return this.toBomDto(published, await this.repo.bomComponentsFor(published.id))
  }

  /** Map a BOM header + edges to the wire DTO (exact-decimal qty/scrap strings; ISO windows). */
  private toBomDto(bom: Bom, components: BomComponent[]): ResolvedBomDto {
    return {
      parentPartNo: bom.parentPartNo,
      revision: bom.revision,
      status: bom.status,
      effectiveFrom: bom.effectiveFrom ? bom.effectiveFrom.toISOString() : null,
      effectiveTo: bom.effectiveTo ? bom.effectiveTo.toISOString() : null,
      components: components.map((c) => ({ componentPartNo: c.componentPartNo, qtyPer: c.qtyPer, scrapPct: c.scrapPct })),
    }
  }
}
