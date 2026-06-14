import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import {
  createRoleSchema,
  createUserSchema,
  updateRoleSchema,
  updateUserSchema,
  type CreateRoleRequest,
  type CreateUserRequest,
  type UpdateRoleRequest,
  type UpdateUserRequest,
} from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { AuthService } from './auth.service'

/**
 * Admin CRUD for users, roles, and approval tiers (`/admin/*`). Both guards
 * required (API §11): JwtAuthGuard + ConfigureGuard (the `configure` permission,
 * D33). Tenant-scoped from the JWT. Role writes validate scope refs via the
 * `org.read` contract in the service (O4).
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, ConfigureGuard)
export class AuthAdminController {
  constructor(private readonly auth: AuthService) {}

  /** `GET /admin/users` — list the tenant's users. */
  @Get('users')
  listUsers(@CurrentUser() user: JwtPayload) {
    return this.auth.listUsers(user.tenantId)
  }

  /** `POST /admin/users` — create a user. */
  @Post('users')
  createUser(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserRequest,
  ) {
    return this.auth.createUser(user.tenantId, dto)
  }

  /** `PATCH /admin/users/:id` — update a user. */
  @Patch('users/:id')
  updateUser(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserRequest,
  ) {
    return this.auth.updateUser(user.tenantId, id, dto)
  }

  /** `GET /admin/roles` — list the tenant's roles. */
  @Get('roles')
  listRoles(@CurrentUser() user: JwtPayload) {
    return this.auth.listRoles(user.tenantId)
  }

  /** `POST /admin/roles` — create a role. */
  @Post('roles')
  createRole(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createRoleSchema)) dto: CreateRoleRequest,
  ) {
    return this.auth.createRole(user.tenantId, dto)
  }

  /** `PATCH /admin/roles/:id` — update a role. */
  @Patch('roles/:id')
  updateRole(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleRequest,
  ) {
    return this.auth.updateRole(user.tenantId, id, dto)
  }

  /** `GET /admin/approval-tiers` — list the tenant's approval tiers. */
  @Get('approval-tiers')
  listApprovalTiers(@CurrentUser() user: JwtPayload) {
    return this.auth.listApprovalTiers(user.tenantId)
  }
}
