import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { JwtPayload } from '../types/jwt-payload.types'

/** Injects the authenticated user (JWT payload) into a controller handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest<{ user: JwtPayload }>().user,
)
