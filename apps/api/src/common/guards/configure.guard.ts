import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { JwtPayload } from '../types/jwt-payload.types'

/**
 * Admin authorization gate. Admin/config routes stack `JwtAuthGuard` (authn) +
 * this guard (authz) — both are required (API §11). It grants access only to
 * users whose role carries the `configure` permission (D33; phase-0 capability,
 * SKIP-43). Full per-dashboard action rights replace this later.
 */
@Injectable()
export class ConfigureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>()
    return Boolean(request.user?.canConfigure)
  }
}
