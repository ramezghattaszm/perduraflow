import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common'
import {
  createCalendarSchema,
  createCustomerSchema,
  createLineSchema,
  createPlantGroupSchema,
  createPlantSchema,
  createProgramSchema,
  updateCalendarSchema,
  updateCustomerSchema,
  updateLineSchema,
  updatePlantGroupSchema,
  updatePlantSchema,
  updateProgramSchema,
  type CreateCalendarRequest,
  type CreateCustomerRequest,
  type CreateLineRequest,
  type CreatePlantGroupRequest,
  type CreatePlantRequest,
  type CreateProgramRequest,
  type UpdateCalendarRequest,
  type UpdateCustomerRequest,
  type UpdateLineRequest,
  type UpdatePlantGroupRequest,
  type UpdatePlantRequest,
  type UpdateProgramRequest,
} from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { OrgService } from './org.service'

/**
 * Admin CRUD for the organizational model (`/admin/org/*`). Both guards required
 * (API §11): JwtAuthGuard + ConfigureGuard (the `configure` permission, D33).
 * Every write is tenant-scoped from the JWT.
 */
@Controller('admin/org')
@UseGuards(JwtAuthGuard, ConfigureGuard)
export class OrgAdminController {
  constructor(private readonly org: OrgService) {}

  /** `POST /admin/org/plants` — create a plant. */
  @Post('plants')
  createPlant(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createPlantSchema)) dto: CreatePlantRequest,
  ) {
    return this.org.createPlant(user.tenantId, dto)
  }

  /** `PATCH /admin/org/plants/:id` — update a plant. */
  @Patch('plants/:id')
  updatePlant(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePlantSchema)) dto: UpdatePlantRequest,
  ) {
    return this.org.updatePlant(user.tenantId, id, dto)
  }

  /** `POST /admin/org/lines` — create a line under a plant (S0a). */
  @Post('lines')
  createLine(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createLineSchema)) dto: CreateLineRequest,
  ) {
    return this.org.createLine(user.tenantId, dto)
  }

  /** `PATCH /admin/org/lines/:id` — update a line (S0a). */
  @Patch('lines/:id')
  updateLine(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLineSchema)) dto: UpdateLineRequest,
  ) {
    return this.org.updateLine(user.tenantId, id, dto)
  }

  /** `POST /admin/org/plant-groups` — create a plant group. */
  @Post('plant-groups')
  createPlantGroup(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createPlantGroupSchema)) dto: CreatePlantGroupRequest,
  ) {
    return this.org.createPlantGroup(user.tenantId, dto)
  }

  /** `PATCH /admin/org/plant-groups/:id` — update a plant group. */
  @Patch('plant-groups/:id')
  updatePlantGroup(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePlantGroupSchema)) dto: UpdatePlantGroupRequest,
  ) {
    return this.org.updatePlantGroup(user.tenantId, id, dto)
  }

  /** `POST /admin/org/customers` — create a customer. */
  @Post('customers')
  createCustomer(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createCustomerSchema)) dto: CreateCustomerRequest,
  ) {
    return this.org.createCustomer(user.tenantId, dto)
  }

  /** `PATCH /admin/org/customers/:id` — update a customer. */
  @Patch('customers/:id')
  updateCustomer(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) dto: UpdateCustomerRequest,
  ) {
    return this.org.updateCustomer(user.tenantId, id, dto)
  }

  /** `POST /admin/org/programs` — create a program. */
  @Post('programs')
  createProgram(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createProgramSchema)) dto: CreateProgramRequest,
  ) {
    return this.org.createProgram(user.tenantId, dto)
  }

  /** `PATCH /admin/org/programs/:id` — update a program. */
  @Patch('programs/:id')
  updateProgram(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProgramSchema)) dto: UpdateProgramRequest,
  ) {
    return this.org.updateProgram(user.tenantId, id, dto)
  }

  /** `POST /admin/org/calendars` — create a calendar. */
  @Post('calendars')
  createCalendar(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createCalendarSchema)) dto: CreateCalendarRequest,
  ) {
    return this.org.createCalendar(user.tenantId, dto)
  }

  /** `PATCH /admin/org/calendars/:id` — update a calendar. */
  @Patch('calendars/:id')
  updateCalendar(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCalendarSchema)) dto: UpdateCalendarRequest,
  ) {
    return this.org.updateCalendar(user.tenantId, id, dto)
  }
}
