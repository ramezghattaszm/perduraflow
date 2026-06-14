import type { AdminUser, ApprovalTier as ApprovalTierDto, DataScope, Role as RoleDto, UserProfile } from '@perduraflow/contracts'
import type { ApprovalTier, Role, User } from './schema'

/**
 * Map a user row (+ its resolved role) to the private profile DTO. The role is
 * resolved to `roleName` + `canConfigure` here (D33) rather than a hardcoded
 * enum. Never includes passwordHash (API §11).
 */
export function toUserProfile(u: User, r: Role | undefined): UserProfile {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    roleId: u.roleId,
    roleName: r?.name ?? null,
    canConfigure: r?.canConfigure ?? false,
    tenantId: u.tenantId,
    isVerified: u.isVerified,
    createdAt: u.createdAt.toISOString(),
  }
}

/** Map a user row (+ role) to the admin user DTO (Users admin screen). */
export function toAdminUser(u: User, r: Role | undefined): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roleId: u.roleId,
    roleName: r?.name ?? null,
    isVerified: u.isVerified,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  }
}

/** Map a role row to the Role DTO. */
export function toRoleDto(r: Role): RoleDto {
  return {
    id: r.id,
    name: r.name,
    isDefaultSeed: r.isDefaultSeed,
    dataScope: r.dataScope as DataScope,
    scopedPlantIds: (r.scopedPlantIds as string[] | null) ?? [],
    scopedPlantGroupIds: (r.scopedPlantGroupIds as string[] | null) ?? [],
    approvalTierId: r.approvalTierId,
    canConfigure: r.canConfigure,
    isActive: r.isActive,
  }
}

/** Map an approval tier row to its DTO. */
export function toApprovalTierDto(t: ApprovalTier): ApprovalTierDto {
  return { id: t.id, name: t.name, rank: t.rank }
}
