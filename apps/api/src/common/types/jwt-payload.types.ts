import type { UserRole } from '@perduraflow/contracts'

/**
 * JWT access-token payload. Carries the tenant scope (tenantId) resolved at
 * registration — every user-facing query is scoped by it server-side. No
 * second-level grouping (no exchangeId): apps that need one add it here.
 */
export interface JwtPayload {
  sub: string // user ULID
  email: string
  role: UserRole
  tenantId: string
}
