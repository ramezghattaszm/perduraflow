import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common'
import { type UpdateProfileRequest, updateProfileSchema } from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { UsersService } from './users.service'

/**
 * Authenticated `/users` routes. JwtAuthGuard protects every route; the user id
 * always comes from the JWT (`@CurrentUser`), never a path/body param (§11).
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** `GET /users/me` — the caller's own profile (id derived from the JWT only). */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.users.getMe(user.sub)
  }

  /** `PATCH /users/me` — update the caller's own profile. */
  @Patch('me')
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileRequest,
  ) {
    return this.users.updateMe(user.sub, dto)
  }
}
