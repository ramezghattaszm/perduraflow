import { z } from 'zod'

/**
 * Policy module contract (`policy.read`, phase 4 — api-spec §13.5). Owns the
 * per-tenant **autonomy config** — the confidence threshold + tier behavior that
 * the learning gate reads to decide auto-commit vs. propose (A18 trust envelope,
 * D42 configurable, D48 safe defaults). A platform read consumed directly by the
 * gate (like the kernel `org.read`), not a per-tenant binding. Objective trade-off
 * weights (service floor / OT / churn) are a Phase-5 seam — not in this contract yet.
 */
export const POLICY_READ_CONTRACT = { id: 'policy.read', version: '1.0' } as const

/** Tier-2 behavior: advisory-first (propose) or bounded-auto (confidence may raise within bounds). */
export const tier2ModeSchema = z.enum(['advisory', 'bounded_auto'])
export type Tier2Mode = z.infer<typeof tier2ModeSchema>

/**
 * Per-tenant autonomy config (api-spec §13.5). `tier1AutoThreshold` is the dial the
 * confidence×tier gate uses for Tier-1 auto-commit; Tier-3 is always human (the A18
 * floor — not tenant-relaxable, so it carries no field). Safe defaults D48.
 */
export interface AutonomyConfigDto {
  /** Tier-1 confidence ≥ this auto-commits a predicted parameter adjust; below → queue. 0–1. */
  tier1AutoThreshold: number
  /** Tier-2 soft-policy behavior (advisory-first default). */
  tier2Mode: Tier2Mode
  /** The crossing-threshold band the predictor measures against (fraction over std); null = §12.7 default. */
  wearBand: number | null
}

/** Safe defaults (D48 — conservative). The gate falls back to these when unconfigured. */
export const AUTONOMY_DEFAULTS: AutonomyConfigDto = {
  tier1AutoThreshold: 0.75,
  tier2Mode: 'advisory',
  wearBand: null,
}

/** PUT body for the Objective-Policy autonomy controls (View 5; ConfigureGuard, D42 audited). */
export const autonomyConfigUpdateSchema = z
  .object({
    tier1AutoThreshold: z.number().min(0).max(1),
    tier2Mode: tier2ModeSchema,
    wearBand: z.number().positive().max(2).nullable().default(null),
  })
  .strict()
export type AutonomyConfigUpdate = z.infer<typeof autonomyConfigUpdateSchema>

/**
 * Published `policy.read 1.0` interface — the learning gate reads the autonomy
 * config. No transport (O6); tenant-scoped by the caller.
 */
export interface PolicyReadContract {
  readonly contract: typeof POLICY_READ_CONTRACT
  /** The tenant's autonomy config, or the safe defaults if none persisted. */
  getAutonomyConfig(tenantId: string): Promise<AutonomyConfigDto>
}
