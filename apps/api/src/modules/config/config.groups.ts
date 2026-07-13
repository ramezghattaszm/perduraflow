import {
  AUTONOMY_POLICY_DEFAULTS,
  type ConfigGroupKey,
  type ConfigValue,
  constraintModeSchema,
  CONSTRAINT_POLICIES,
  firmLatenessDominates,
  kpiBandFieldKeys,
  KPI_POLICY_DEFAULTS,
  KPI_THRESHOLD_METRICS,
  OBJECTIVE_DEFAULTS,
  OBJECTIVE_WEIGHT_KEYS,
  objectiveWeightsSchema,
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
  // Option B: recover the shape safety the closed union gave — Zod-parse the resolved value set (every value
  // a non-negative number) BEFORE the dominance guard, instead of an unchecked `as ObjectiveWeights` cast.
  // Known-key rejection is already enforced by the config write path (fields are registry-derived).
  validate: (values) => {
    const parsed = objectiveWeightsSchema.safeParse(values)
    if (!parsed.success) return { ok: false, warnings: parsed.error.issues.map((i) => `${i.path.join('.') || 'weights'}: ${i.message}`) }
    return firmLatenessDominates(parsed.data)
  },
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
 * Group 3 — KPI / Metric Policy (902 dashboard). The configurable **measure** (On-Time tolerance, a
 * minutes value) + per-KPI **threshold bands** (green/amber as 0–1 rate percents, generated from
 * {@link KPI_THRESHOLD_METRICS}). Defaults reproduce current behavior (tolerance 0). The `validate` guard
 * keeps each band ordered for its direction (higher-better: green ≥ amber; lower-better: green ≤ amber).
 */
const KPI: ConfigGroupDescriptor = {
  key: 'kpi',
  defaults: { ...KPI_POLICY_DEFAULTS },
  fields: [
    { key: 'onTimeToleranceMinutes', kind: 'int', min: 0, max: 10080, display: 'raw', control: 'number' },
    ...KPI_THRESHOLD_METRICS.flatMap((m) => {
      const k = kpiBandFieldKeys(m.key)
      const band = { kind: 'number' as const, min: 0, max: 1, display: 'percent' as const, control: 'slider' as const, sliderMax: 100, sliderStep: 1 }
      return [
        { key: k.green, ...band },
        { key: k.amber, ...band },
      ]
    }),
  ],
  validate: (values) => {
    const warnings: string[] = []
    for (const m of KPI_THRESHOLD_METRICS) {
      const k = kpiBandFieldKeys(m.key)
      const green = Number(values[k.green])
      const amber = Number(values[k.amber])
      const ordered = m.direction === 'higher' ? green >= amber : green <= amber
      if (!ordered) {
        warnings.push(
          `${m.key}: green (${green}) and amber (${amber}) are out of order for a ${m.direction}-better metric`,
        )
      }
    }
    return { ok: warnings.length === 0, warnings }
  },
}

/**
 * Group 5 — Constraint Application Policy (S1.3). Per-constraint `mode` (hard / soft / hard-with-slack) +
 * a slack `threshold`, resolving the full ladder **global → tenant → plant → line** (D-S1.3-3/6). Its keyed
 * fields DERIVE from the {@link CONSTRAINT_POLICIES} registry — **EMPTY in S1.3**, so the group is field-less
 * and inert (no constraint carries a mode; D28/D9/JIS are S2/S3). The `validate` guard parses each resolved
 * `<id>.mode` against {@link constraintModeSchema} — a no-op while the registry is empty.
 */
const CONSTRAINT_POLICY: ConfigGroupDescriptor = {
  key: 'constraint_policy',
  defaults: Object.fromEntries(
    CONSTRAINT_POLICIES.flatMap((c) => [
      [`${c.constraintId}.mode`, c.defaultMode] as [string, ConfigValue],
      ...(c.defaultThreshold != null ? ([[`${c.constraintId}.threshold`, c.defaultThreshold]] as [string, ConfigValue][]) : []),
    ]),
  ),
  fields: CONSTRAINT_POLICIES.flatMap((c) => [
    { key: `${c.constraintId}.mode`, kind: 'text' as const },
    { key: `${c.constraintId}.threshold`, kind: 'number' as const, min: 0 },
  ]),
  validate: (values) => {
    const warnings: string[] = []
    for (const c of CONSTRAINT_POLICIES) {
      const parsed = constraintModeSchema.safeParse(values[`${c.constraintId}.mode`])
      if (!parsed.success) warnings.push(`${c.constraintId}.mode: must be one of hard | soft | hard-with-slack`)
    }
    return { ok: warnings.length === 0, warnings }
  },
}

/**
 * The group registry. Stage 1: `reporting`; Stage 2: `objective` (weights + dominance guard);
 * Stage 3: `autonomy` (folded from the retired policy module); Stage 4: `kpi` (902 dashboard
 * configurable measures + threshold bands); S1.3: `constraint_policy` (per-constraint application mode — inert).
 */
export const CONFIG_GROUPS: Partial<Record<ConfigGroupKey, ConfigGroupDescriptor>> = {
  objective: OBJECTIVE,
  reporting: REPORTING,
  autonomy: AUTONOMY,
  kpi: KPI,
  constraint_policy: CONSTRAINT_POLICY,
}

/** Resolve a group descriptor or throw a typed "unknown group" for the controller to 404/400. */
export function getGroupDescriptor(group: ConfigGroupKey): ConfigGroupDescriptor | undefined {
  return CONFIG_GROUPS[group]
}
