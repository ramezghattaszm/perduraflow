import { SetMetadata } from '@nestjs/common'
import type { UserRole } from '@perduraflow/contracts'

/** Metadata key under which `Roles` stores the allowed roles (read by RolesGuard). */
export const ROLES_KEY = 'roles'
/**
 * Route/handler decorator declaring the roles allowed to access it. Pairs with
 * RolesGuard; admin routes also stack JwtAuthGuard (API-ARCHITECTURE.md §11).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles)
