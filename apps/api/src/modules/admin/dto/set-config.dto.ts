import { z } from 'zod'

/** Validation schema for upserting a platform config entry (value + optional description). */
export const setConfigSchema = z.object({
  value: z.string(),
  description: z.string().optional(),
})

export type SetConfigRequest = z.infer<typeof setConfigSchema>
