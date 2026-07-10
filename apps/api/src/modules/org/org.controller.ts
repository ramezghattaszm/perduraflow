import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { OrgService } from './org.service'

/**
 * Authenticated read routes for the organizational model (`GET /org/*`). Every
 * query is tenant-scoped from the JWT (`@CurrentUser`). Reads need only
 * authentication; writes live on the admin controller behind ConfigureGuard.
 */
@Controller('org')
@UseGuards(JwtAuthGuard)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  /** `GET /org/plants` — all plants in the tenant. */
  @Get('plants')
  listPlants(@CurrentUser() user: JwtPayload) {
    return this.org.listPlants(user.tenantId)
  }

  /** `GET /org/lines` — all lines in the tenant (S0a). */
  @Get('lines')
  listLines(@CurrentUser() user: JwtPayload) {
    return this.org.listLines(user.tenantId)
  }

  /** `GET /org/plant-groups` — all plant groups (with member ids) in the tenant. */
  @Get('plant-groups')
  listPlantGroups(@CurrentUser() user: JwtPayload) {
    return this.org.listPlantGroups(user.tenantId)
  }

  /** `GET /org/customers` — all customers in the tenant. */
  @Get('customers')
  listCustomers(@CurrentUser() user: JwtPayload) {
    return this.org.listCustomers(user.tenantId)
  }

  /** `GET /org/programs` — all programs in the tenant. */
  @Get('programs')
  listPrograms(@CurrentUser() user: JwtPayload) {
    return this.org.listPrograms(user.tenantId)
  }

  /** `GET /org/calendars` — all calendars in the tenant. */
  @Get('calendars')
  listCalendars(@CurrentUser() user: JwtPayload) {
    return this.org.listCalendars(user.tenantId)
  }
}
