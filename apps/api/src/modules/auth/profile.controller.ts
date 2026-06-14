import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common'
import { type UpdateProfileRequest, updateProfileSchema } from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { AuthService } from './auth.service'

/**
 * Authenticated profile routes (`/users/me`). The user id always comes from the
 * JWT (`@CurrentUser`), never a path/body param (API §11). Folded into the auth
 * module since `user` is auth-owned (api-spec §1).
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly auth: AuthService) {}

  /** `GET /users/me` — the caller's own profile (id from the JWT only). */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.getMe(user.sub)
  }

  /** `PATCH /users/me` — update the caller's own profile. */
  @Patch('me')
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileRequest,
  ) {
    return this.auth.updateMe(user.sub, dto)
  }
}
