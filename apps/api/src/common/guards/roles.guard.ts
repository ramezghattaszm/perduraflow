import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { UserRole } from '@perduraflow/contracts'
import { ROLES_KEY } from '../decorators/roles.decorator'
import type { JwtPayload } from '../types/jwt-payload.types'

/**
 * Role gate. Admin routes use @Roles('admin') together with JwtAuthGuard — both
 * guards are required (API-ARCHITECTURE.md §11).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>()
    if (!request.user) return false
    return required.includes(request.user.role)
  }
}
