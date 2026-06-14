/**
 * JWT access-token payload. Carries the tenant scope (`tenantId`) resolved at
 * login — every user-facing query is scoped by it server-side. The role is a
 * reference into the tenant's editable role set (D33): `roleId`/`roleName` for
 * display, and `canConfigure` (the `configure` permission) for admin gating
 * (SKIP-43 keeps the permission set to this one capability for phase 0).
 */
export interface JwtPayload {
  sub: string // user ULID
  email: string
  tenantId: string
  roleId: string | null
  roleName: string | null
  canConfigure: boolean
}
