import {
  AUTONOMY_POLICY_DEFAULTS,
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
  /** Presentation of the (always-raw-stored) value — `percent` (×100), `hours` (÷60), or `raw`. */
  display?: 'percent' | 'hours' | 'raw'
  /** Input control — `slider` (+ number), `number`, or `toggle`. Defaults: boolean→toggle, else number. */
  control?: 'slider' | 'number' | 'toggle'
  /** Slider upper bound in DISPLAY units; slider step in display units. */
  sliderMax?: number
  sliderStep?: number
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
 * Group 3 — Autonomy Policy (the learning confidence×tier gate). Stage 3. Tenant-scoped (the gate
 * has no plant context; the autonomy boundary is a tenant-wide trust policy) — global → tenant only.
 * Every field is real-valued (the floor IS the default), so the gate reads the resolved value
 * directly. `boundedAuto` is the Tier-2 mode as a boolean.
 */
const AUTONOMY: ConfigGroupDescriptor = {
  key: 'autonomy',
  defaults: { ...AUTONOMY_POLICY_DEFAULTS },
  fields: [
    // Confidence dials → percent sliders (0–100%). wearBand is fractional too but realistic values
    // are small, so its slider caps at 50% (the stored max stays 2 = 200%). Snooze urgency is a
    // duration → shown in hours, number-only (a slider over minutes→days is useless). Mode → toggle.
    { key: 'tier1AutoThreshold', kind: 'number', min: 0, max: 1, display: 'percent', control: 'slider', sliderMax: 100, sliderStep: 1 },
    { key: 'wearBand', kind: 'number', min: 0, max: 2, display: 'percent', control: 'slider', sliderMax: 50, sliderStep: 1 },
    { key: 'snoozeConfDelta', kind: 'number', min: 0, max: 1, display: 'percent', control: 'slider', sliderMax: 100, sliderStep: 1 },
    { key: 'snoozeUrgencyMinutes', kind: 'int', min: 1, max: 100000, display: 'hours', control: 'number' },
    { key: 'boundedAuto', kind: 'boolean', control: 'toggle' },
  ],
}

/**
 * The group registry. Stage 1: `reporting`; Stage 2: `objective` (weights + dominance guard);
 * Stage 3: `autonomy` (folded from the retired policy module).
 */
export const CONFIG_GROUPS: Partial<Record<ConfigGroupKey, ConfigGroupDescriptor>> = {
  objective: OBJECTIVE,
  reporting: REPORTING,
  autonomy: AUTONOMY,
}

/** Resolve a group descriptor or throw a typed "unknown group" for the controller to 404/400. */
export function getGroupDescriptor(group: ConfigGroupKey): ConfigGroupDescriptor | undefined {
  return CONFIG_GROUPS[group]
}
