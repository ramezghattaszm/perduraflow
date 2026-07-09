import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { BomReadService } from './bom-read.service'
import { MasterDataService } from './master-data.service'

/**
 * Authenticated read routes for master data (`GET /master-data/*`). Every query
 * is tenant-scoped from the JWT. Reads need only authentication; writes live on
 * the admin controller behind ConfigureGuard.
 */
@Controller('master-data')
@UseGuards(JwtAuthGuard)
export class MasterDataController {
  constructor(
    private readonly md: MasterDataService,
    private readonly bom: BomReadService,
  ) {}

  /** `GET /master-data/parts` — all parts in the tenant. */
  @Get('parts')
  listParts(@CurrentUser() user: JwtPayload) {
    return this.md.listParts(user.tenantId)
  }

  /** `GET /master-data/resources` — all resources in the tenant. */
  @Get('resources')
  listResources(@CurrentUser() user: JwtPayload) {
    return this.md.listResources(user.tenantId)
  }

  /** `GET /master-data/resource-groups` — all resource groups (with members). */
  @Get('resource-groups')
  listResourceGroups(@CurrentUser() user: JwtPayload) {
    return this.md.listResourceGroups(user.tenantId)
  }

  /** `GET /master-data/downtime` — active downtime windows (line-down / maintenance), optional `?plantId=`. */
  @Get('downtime')
  listActiveDowntime(@CurrentUser() user: JwtPayload, @Query('plantId') plantId?: string) {
    return this.md.listActiveDowntime(user.tenantId, plantId)
  }

  /** `GET /master-data/routings` — all routings (with operations). */
  @Get('routings')
  listRoutings(@CurrentUser() user: JwtPayload) {
    return this.md.listRoutings(user.tenantId)
  }

  /** `GET /master-data/routings/:id` — one routing with its ordered operations. */
  @Get('routings/:id')
  getRouting(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.md.getRouting(user.tenantId, id)
  }

  /** `GET /master-data/certifications` — all certifications in the tenant. */
  @Get('certifications')
  listCertifications(@CurrentUser() user: JwtPayload) {
    return this.md.listCertifications(user.tenantId)
  }

  /** `GET /master-data/operators` — all operators (with held certification ids). */
  @Get('operators')
  listOperators(@CurrentUser() user: JwtPayload) {
    return this.md.listOperators(user.tenantId)
  }

  // --- bom.read reads (Layer 2 2a — auth-only) -------------------------------
  /** `GET /master-data/boms/where-used/:componentPartNo?asOf=` — parents that consume the component (as-of). */
  @Get('boms/where-used/:componentPartNo')
  bomWhereUsed(@CurrentUser() user: JwtPayload, @Param('componentPartNo') componentPartNo: string, @Query('asOf') asOf?: string) {
    return this.bom.whereUsed(user.tenantId, componentPartNo, asOf)
  }

  /** `GET /master-data/boms/:parentPartNo/explode?asOf=` — the multi-level explosion (topology). */
  @Get('boms/:parentPartNo/explode')
  bomExplode(@CurrentUser() user: JwtPayload, @Param('parentPartNo') parentPartNo: string, @Query('asOf') asOf?: string) {
    return this.bom.explodeBom(user.tenantId, parentPartNo, asOf)
  }

  /** `GET /master-data/boms/:parentPartNo/integrity?asOf=` — integrity findings for the draft (or published-as-of). */
  @Get('boms/:parentPartNo/integrity')
  bomIntegrity(@CurrentUser() user: JwtPayload, @Param('parentPartNo') parentPartNo: string, @Query('asOf') asOf?: string) {
    return this.bom.validateBomIntegrity(user.tenantId, parentPartNo, asOf)
  }

  /** `GET /master-data/boms/:parentPartNo?asOf=` — the BOM version effective as-of + edges, or null. */
  @Get('boms/:parentPartNo')
  resolveBom(@CurrentUser() user: JwtPayload, @Param('parentPartNo') parentPartNo: string, @Query('asOf') asOf?: string) {
    return this.bom.resolveBom(user.tenantId, parentPartNo, asOf)
  }
}
