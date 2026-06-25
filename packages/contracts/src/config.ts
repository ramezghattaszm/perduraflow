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

// --- Group: objective policy (weights) --------------------------------------
/** The engine objective-function factor weights — `contribution = rawValue · weight`, lower is better. */
export interface ObjectiveWeights {
  /** Per firm-late hour — the DOMINANT factor (firm delivery protected). */
  lateness: number
  /** Per changeover switch. */
  changeover: number
  /** Per overtime hour (labour premium). */
  overtime: number
  /** Per early hour finished ahead of need (holding pressure). */
  inventory: number
  /** Per operation displaced vs the current plan (nervousness discipline). */
  displacement: number
  /** Per unit of cost (economic factor — must sit far below lateness). */
  cost: number
}

/** The objective weight field keys, in display order. */
export const OBJECTIVE_WEIGHT_KEYS: (keyof ObjectiveWeights)[] = [
  'lateness',
  'changeover',
  'overtime',
  'inventory',
  'displacement',
  'cost',
]

/** Shipped default weights (the `aps-w2` calibration — the current hardcoded constants). */
export const OBJECTIVE_DEFAULTS: ObjectiveWeights = {
  lateness: 10,
  changeover: 1,
  overtime: 4,
  inventory: 0.2,
  displacement: 2,
  cost: 4,
}

/** The default weight-set version token, stamped into a rationale produced with the shipped weights. */
export const OBJECTIVE_DEFAULT_VERSION = 'aps-w2'

/**
 * Firm-lateness-dominance guard ratio — `lateness` must be at least this multiple of **every** other
 * weight, so firm delivery is the unambiguously dominant priority and no other factor can be weighted
 * up to trade a firm order late. Conservative by design (over-protect the invariant). Calibrated so the
 * shipped `aps-w2` default passes (lateness 10 ≥ 2 × max-other 4 = 8) with margin.
 */
export const FIRM_LATENESS_DOMINANCE_RATIO = 2

/** The verdict of the {@link firmLatenessDominates} guard — `ok` plus the offending fields + the ceiling. */
export interface DominanceVerdict {
  ok: boolean
  /** Human-readable reasons (one per problem) for the UI/runtime to surface. */
  warnings: string[]
  /** Non-lateness weight keys that exceed the allowed ceiling (or `['lateness']` when lateness is too low). */
  offending: (keyof ObjectiveWeights)[]
  /** The max any single non-lateness weight may take = `lateness / ratio` (the UI ceiling). */
  maxOtherWeight: number
}

/**
 * THE shared firm-lateness-dominance guard. **One pure definition** used by the locked behavioural
 * test (on the default), the runtime config guard (on a custom set), and the UI live guard — so they
 * can never drift. A weight set passes when every weight is ≥ 0 and `lateness ≥ ratio × max(other
 * weights)` — i.e. firm delivery dominates every other factor by at least the ratio. Conservative:
 * a weight-only floor that over-protects the invariant; the locked test guarantees the default's
 * actual behavioural dominance.
 */
export function firmLatenessDominates(
  w: ObjectiveWeights,
  ratio: number = FIRM_LATENESS_DOMINANCE_RATIO,
): DominanceVerdict {
  const warnings: string[] = []
  const offending: (keyof ObjectiveWeights)[] = []

  const negatives = OBJECTIVE_WEIGHT_KEYS.filter((k) => !(w[k] >= 0))
  for (const k of negatives) {
    warnings.push(`${k} weight must be ≥ 0`)
    offending.push(k)
  }

  const maxOtherWeight = w.lateness / ratio
  const others = OBJECTIVE_WEIGHT_KEYS.filter((k) => k !== 'lateness')
  const tooHeavy = others.filter((k) => w[k] > maxOtherWeight)
  if (tooHeavy.length > 0) {
    for (const k of tooHeavy) offending.push(k)
    warnings.push(
      `firm-lateness dominance: lateness (${w.lateness}) must be ≥ ${ratio}× each other weight; ` +
        `${tooHeavy.map((k) => `${k}=${w[k]}`).join(', ')} exceed the ceiling of ${maxOtherWeight}`,
    )
    // If lateness is the thing that's too small relative to the rest, name it too (UI hint).
    if (!offending.includes('lateness')) offending.push('lateness')
  }

  return { ok: warnings.length === 0, warnings, offending: [...new Set(offending)], maxOtherWeight }
}

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
  /**
   * The resolved Objective weights (plant → tenant → global) + the version token to stamp into the
   * rationale/determinism key (`aps-w2` for the shipped default, `obj:t<rev>`/`obj:p<rev>` for an
   * override) so a stored artifact stays interpretable against the exact weights that produced it.
   */
  resolveObjective(tenantId: string, plantId?: string): Promise<{ weights: ObjectiveWeights; version: string }>
}
