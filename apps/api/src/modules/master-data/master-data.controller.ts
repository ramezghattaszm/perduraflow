import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { MasterDataService } from './master-data.service'

/**
 * Authenticated read routes for master data (`GET /master-data/*`). Every query
 * is tenant-scoped from the JWT. Reads need only authentication; writes live on
 * the admin controller behind ConfigureGuard.
 */
@Controller('master-data')
@UseGuards(JwtAuthGuard)
export class MasterDataController {
  constructor(private readonly md: MasterDataService) {}

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
}
