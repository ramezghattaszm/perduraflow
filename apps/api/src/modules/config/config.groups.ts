import {
  type ConfigGroupKey,
  type ConfigValue,
  firmLatenessDominates,
  OBJECTIVE_DEFAULTS,
  OBJECTIVE_WEIGHT_KEYS,
  type ObjectiveWeights,
  REPORTING_DEFAULTS,
} from '@perduraflow/contracts'

/** UI/validation metadata for one field of a setting group. */
export interface GroupFieldSpec {
  key: string
  kind: 'int' | 'number' | 'text' | 'boolean'
  min?: number
  max?: number
}

/**
 * A setting group's plug-in descriptor — the ONLY per-group code the framework needs:
 * its shipped defaults (the `global` floor), its field metadata, and an optional guard
 * that validates a fully-resolved value set (e.g. the firm-lateness-dominance guard for
 * weights, Stage 2). The generic {@link ConfigService} does resolve/cascade/reset/audit.
 */
export interface ConfigGroupDescriptor {
  key: ConfigGroupKey
  /** The shipped global defaults — every field has a default (the floor). */
  defaults: Record<string, ConfigValue>
  fields: GroupFieldSpec[]
  /** Optional group guard run on the merged (resolved) value set before a write is accepted. */
  validate?: (values: Record<string, ConfigValue>) => { ok: boolean; warnings: string[] }
}

/** Group 2 — Reporting Policy (the KPI reporting window). Stage 1. */
const REPORTING: ConfigGroupDescriptor = {
  key: 'reporting',
  defaults: { ...REPORTING_DEFAULTS },
  fields: [{ key: 'reportingWindowDays', kind: 'int', min: 1, max: 365 }],
}

/**
 * Group 1 — Objective Policy (the engine objective-function weights). Stage 2. The `validate` guard
 * is the SHARED {@link firmLatenessDominates} — the same pure fn the locked behavioural test and the
 * UI live guard use, so a custom set can never break firm-lateness dominance. Each weight is a
 * non-negative number; a 0–100 UI range keeps them in a sane band (the guard enforces the invariant).
 */
const OBJECTIVE: ConfigGroupDescriptor = {
  key: 'objective',
  defaults: { ...OBJECTIVE_DEFAULTS },
  fields: OBJECTIVE_WEIGHT_KEYS.map((key) => ({ key, kind: 'number' as const, min: 0, max: 100 })),
  validate: (values) => firmLatenessDominates(values as unknown as ObjectiveWeights),
}

/**
 * The group registry. Stage 1: `reporting`; Stage 2: `objective` (weights + dominance guard).
 * `autonomy` (folded from the policy module) registers here in a later stage.
 */
export const CONFIG_GROUPS: Partial<Record<ConfigGroupKey, ConfigGroupDescriptor>> = {
  objective: OBJECTIVE,
  reporting: REPORTING,
}

/** Resolve a group descriptor or throw a typed "unknown group" for the controller to 404/400. */
export function getGroupDescriptor(group: ConfigGroupKey): ConfigGroupDescriptor | undefined {
  return CONFIG_GROUPS[group]
}
