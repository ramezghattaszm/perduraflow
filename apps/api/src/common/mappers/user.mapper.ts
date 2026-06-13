import type { UserProfile } from '@perduraflow/contracts'
import type { User } from '../../db/schema'

/** Map a DB user row to the private (me) DTO. Never includes passwordHash. */
export function toUserProfile(u: User): UserProfile {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    role: u.role,
    tenantId: u.tenantId,
    isVerified: u.isVerified,
    createdAt: u.createdAt.toISOString(),
  }
}
