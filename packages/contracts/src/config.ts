import { z } from 'zod'

/**
 * Hierarchical configuration framework contract (`config.read`) — the reusable
 * mechanism for tenant/plant-scoped policy/preference settings (CONFIG-FRAMEWORK-DESIGN.md).
 * Resolution is **plant override → tenant override → global default** (most specific wins;
 * `global` is the shipped-default floor, held in code per group). Each setting **group**
 * (objective weights, reporting window, autonomy) plugs into the same resolve/cascade/
 * reset/audit mechanism. This file is the wire shape; the per-group descriptors (defaults +
 * validation) live server-side.
 *
 * Stage 1 ships the framework + the **reporting** group (the KPI reporting window). Objective
 * (weights) and autonomy register conceptually but are not yet served through the framework.
 */
export const CONFIG_READ_CONTRACT = { id: 'config.read', version: '1.0' } as const

/** The setting groups that plug into the framework. */
export const configGroupKeySchema = z.enum(['objective', 'reporting', 'autonomy'])
export type ConfigGroupKey = z.infer<typeof configGroupKeySchema>

/** Resolution levels — `global` is the shipped default floor; tenant/plant are stored overrides. */
export const configLevelSchema = z.enum(['global', 'tenant', 'plant'])
export type ConfigLevel = z.infer<typeof configLevelSchema>

/** A settings value — groups hold flat scalar fields (numbers/strings/booleans). */
export type ConfigValue = number | string | boolean

/**
 * One field of a resolved group, with its **effective** value, the level it **resolved from**
 * (provenance — "inherited from tenant" vs "overridden at plant"), and the raw value at each
 * level (so the UI can render the global→tenant→plant cascade columns). `kind`/`min`/`max`
 * drive the input control.
 */
export interface ConfigFieldView {
  key: string
  value: ConfigValue
  /** Which level supplied the effective value. */
  provenance: ConfigLevel
  /** Shipped default (the floor). */
  global: ConfigValue
  /** Tenant override for this field, or null if none. */
  tenant: ConfigValue | null
  /** Plant override for this field, or null if none / no plant scope requested. */
  plant: ConfigValue | null
  kind: 'int' | 'number' | 'text' | 'boolean'
  min?: number
  max?: number
}

/** A resolved group for the config UI — the field cascade + the override revisions in force. */
export interface ConfigGroupView {
  group: ConfigGroupKey
  /** The plant scope the resolution used (null = tenant-level resolution only). */
  scopePlantId: string | null
  fields: ConfigFieldView[]
  /** Override revisions in force (for versioning/audit display); null where no override exists. */
  revisions: { tenant: number | null; plant: number | null }
}

/**
 * PUT body — set a sparse override at a level. `fields` carries only the keys this level
 * overrides (the rest cascade from the parent). Validated server-side against the group
 * descriptor (and any group guard, e.g. the firm-lateness-dominance guard for weights).
 */
export const configOverrideUpdateSchema = z
  .object({
    fields: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  })
  .strict()
export type ConfigOverrideUpdate = z.infer<typeof configOverrideUpdateSchema>

// --- Group: reporting policy (Stage 1) --------------------------------------
/**
 * Reporting Policy — the trailing window over which **continuous plant throughput** (and
 * sibling continuous KPIs) is reported. A *reporting/display* policy (distinct from the
 * *scheduling* objective weights). Stops at plant so a plant's lanes share one window and
 * stay comparable on the KPI strip (CONFIG-FRAMEWORK-DESIGN §Group 2).
 */
export interface ReportingPolicy {
  /** Trailing reporting period in days for plant-performance KPIs. */
  reportingWindowDays: number
}

/** Shipped default reporting window (covers the demo seed's ~12-day rolling history). */
export const REPORTING_DEFAULTS: ReportingPolicy = { reportingWindowDays: 14 }

/**
 * Published `config.read 1.0` interface — in-process resolution of a group's effective settings
 * for cross-module consumers (e.g. scheduling's continuous-throughput metric reads the resolved
 * reporting window). Group-specific methods keep the surface typed + minimal; add one per group
 * as it comes online. No transport (O6); tenant/plant scoped by the caller.
 */
export interface ConfigReadContract {
  readonly contract: typeof CONFIG_READ_CONTRACT
  /** The resolved Reporting Policy for a tenant (+ optional plant) — plant → tenant → global. */
  resolveReporting(tenantId: string, plantId?: string): Promise<ReportingPolicy>
}
