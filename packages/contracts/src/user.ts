import { z } from 'zod'
import type { UserRole } from './common'

/**
 * Public user shape returned by /users/me and embedded in auth responses.
 * This is the "private" DTO tier (the user's own view); it never includes
 * passwordHash or other secrets (API-ARCHITECTURE.md §11).
 */
export interface UserProfile {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  role: UserRole
  tenantId: string
  isVerified: boolean
  createdAt: string
}

export const updateProfileSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    avatarUrl: z.string().url().nullable().optional(),
  })
  .strict()

export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>
