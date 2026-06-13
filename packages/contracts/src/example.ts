import { z } from 'zod'

/**
 * The `example` resource — a user-owned record that is the reference shape for
 * every future resource module. It carries owner + tenant scoping and soft-delete
 * (isActive), mirroring the API's example schema (API-ARCHITECTURE.md §2/§11).
 */
export interface ExampleItem {
  id: string
  ownerId: string
  tenantId: string
  title: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export const createExampleSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
})
export type CreateExampleRequest = z.infer<typeof createExampleSchema>

export const updateExampleSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict()
export type UpdateExampleRequest = z.infer<typeof updateExampleSchema>
