import { z } from 'zod'

/**
 * RBAC contract shapes (D33/D25). Phase 0 seeds the role *structure* — a
 * permission set (here reduced to the `configure` capability), a data scope, and
 * an approval tier — but not the full per-dashboard action matrix (SKIP-43).
 */

/** Breadth of data a role can see/act on (D33). */
export const dataScopeSchema = z.enum(['plant', 'plant_group', 'multi_plant', 'tenant'])
export type DataScope = z.infer<typeof dataScopeSchema>

/** An approval tier (D25): a named rung in the approval ladder, ordered by `rank`. */
export interface ApprovalTier {
  id: string
  name: string
  rank: number
}

/** A role as the admin screens and `/auth/me` see it (D33; SKIP-43 = structure only). */
export interface Role {
  id: string
  name: string
  isDefaultSeed: boolean
  dataScope: DataScope
  /** org plant IDs this role is scoped to (plain text refs, validated via org.read — O4). */
  scopedPlantIds: string[]
  /** org plant-group IDs this role is scoped to (plain text refs, validated via org.read — O4). */
  scopedPlantGroupIds: string[]
  approvalTierId: string | null
  /** The `configure` permission (D33) — gates admin CRUD in phase 0 (SKIP-43). */
  canConfigure: boolean
  /** Soft-delete flag (deactivate, never hard delete). */
  isActive: boolean
}

export const createRoleSchema = z
  .object({
    name: z.string().min(1).max(120),
    dataScope: dataScopeSchema.default('plant'),
    scopedPlantIds: z.array(z.string()).default([]),
    scopedPlantGroupIds: z.array(z.string()).default([]),
    approvalTierId: z.string().nullable().default(null),
    canConfigure: z.boolean().default(false),
  })
  .strict()
export type CreateRoleRequest = z.infer<typeof createRoleSchema>

export const updateRoleSchema = createRoleSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>
