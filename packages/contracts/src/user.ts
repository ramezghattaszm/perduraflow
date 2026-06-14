import { z } from 'zod'

/**
 * Per-user UI preferences (server-persisted, never browser storage — UI shell
 * spec §6). Open shape so new prefs can be added without changing the table.
 */
export interface UserPreferences {
  /** Sidebar collapsed to the icon rail; default expanded. */
  sidebarCollapsed?: boolean
}

/** Zod schema for a partial preferences patch (merged server-side). */
export const userPreferencesSchema = z
  .object({
    sidebarCollapsed: z.boolean().optional(),
  })
  .strict()

/**
 * Private user shape returned by `/users/me` and embedded in auth responses.
 * This is the "private" DTO tier (the user's own view); it never includes
 * passwordHash or other secrets (API-ARCHITECTURE.md §11). The role is a
 * reference into the tenant's editable role set (D33) — resolved to `roleId` +
 * `roleName` + the `canConfigure` capability rather than a hardcoded enum.
 * Carries the tenant brand (name + logo) so the shell can render the OrgAvatar
 * without a second request (UI shell spec §4).
 */
export interface UserProfile {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  roleId: string | null
  roleName: string | null
  canConfigure: boolean
  tenantId: string
  tenantName: string
  tenantLogoUrl: string | null
  preferences: UserPreferences
  isVerified: boolean
  createdAt: string
}

export const updateProfileSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    avatarUrl: z.string().url().nullable().optional(),
    preferences: userPreferencesSchema.optional(),
  })
  .strict()

export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>

/** Admin view of a user row (Users admin screen). No secrets. */
export interface AdminUser {
  id: string
  email: string
  name: string
  roleId: string | null
  roleName: string | null
  isVerified: boolean
  /** Soft-delete flag (deactivate, never hard delete). */
  isActive: boolean
  createdAt: string
}

export const createUserSchema = z
  .object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    roleId: z.string().nullable().default(null),
    isVerified: z.boolean().default(true),
  })
  .strict()
export type CreateUserRequest = z.infer<typeof createUserSchema>

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    roleId: z.string().nullable().optional(),
    isVerified: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
export type UpdateUserRequest = z.infer<typeof updateUserSchema>
