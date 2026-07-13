import { Injectable } from '@nestjs/common'
import {
  type AutonomyPolicy,
  CONFIG_READ_CONTRACT,
  type ConfigReadContract,
  constraintModeSchema,
  CONSTRAINT_POLICIES,
  type KpiPolicy,
  type KpiThreshold,
  type KpiThresholdKey,
  KPI_THRESHOLD_METRICS,
  kpiBandFieldKeys,
  OBJECTIVE_DEFAULT_VERSION,
  OBJECTIVE_WEIGHT_KEYS,
  type ObjectiveWeights,
  type ReportingPolicy,
  type ResolvedConstraintPolicy,
} from '@perduraflow/contracts'
import { ConfigService } from './config.service'

/** DI token for the published `config.read 1.0` interface (consumed cross-module, e.g. by scheduling). */
export const CONFIG_READ = Symbol('CONFIG_READ')

/**
 * In-process implementation of `config.read 1.0`. The surface cross-module consumers use to
 * resolve a group's effective settings without reaching into the config repository (O1). Stage 1
 * exposes the Reporting Policy (the continuous-throughput window); more groups add methods here.
 */
@Injectable()
export class ConfigReadService implements ConfigReadContract {
  readonly contract = CONFIG_READ_CONTRACT

  constructor(private readonly config: ConfigService) {}

  /** Resolved Reporting Policy (plant → tenant → global) for the continuous-KPI window. */
  async resolveReporting(tenantId: string, plantId?: string): Promise<ReportingPolicy> {
    const { values } = await this.config.resolve('reporting', tenantId, plantId)
    return { reportingWindowDays: Number(values['reportingWindowDays']) }
  }

  /**
   * Resolved Objective weights (plant → tenant → global) + the version token to stamp into the
   * rationale/determinism key. The token reflects the highest-precedence level that contributed any
   * override (`obj:p<rev>` plant, `obj:t<rev>` tenant, else the shipped `aps-w2`) — so a stored
   * rationale stays interpretable against the exact weights, and a weight change invalidates the
   * what-if cache (the token feeds the determinism key).
   */
  async resolveObjective(tenantId: string, plantId?: string, lineId?: string): Promise<{ weights: ObjectiveWeights; version: string }> {
    const { values, provenance, revisions } = await this.config.resolve('objective', tenantId, plantId, lineId)
    // Option B: the weight set is registry-keyed (derive from OBJECTIVE_WEIGHT_KEYS), not a hardcoded literal —
    // so a future registered weight resolves without touching this consumer. Byte-identical for the six.
    const weights: ObjectiveWeights = Object.fromEntries(OBJECTIVE_WEIGHT_KEYS.map((k) => [k, Number(values[k])]))
    const levels = Object.values(provenance)
    // Precedence line → plant → tenant → default. `line` never contributes while inert (no line override seeded).
    const version = levels.includes('line')
      ? `obj:L${revisions.line ?? 0}`
      : levels.includes('plant')
        ? `obj:p${revisions.plant ?? 0}`
        : levels.includes('tenant')
          ? `obj:t${revisions.tenant ?? 0}`
          : OBJECTIVE_DEFAULT_VERSION
    return { weights, version }
  }

  /**
   * Resolved per-constraint application policy (line → plant → tenant → global) — the S1.3 mode→behavior
   * bridge's input. Derives each registered constraint's effective `mode` (+ slack threshold) from the
   * `constraint_policy` group. **Empty while inert:** {@link CONSTRAINT_POLICIES} is empty (no constraint
   * carries a mode yet), so this returns no modes and the bridge applies nothing.
   */
  async resolveConstraintPolicy(tenantId: string, plantId?: string, lineId?: string): Promise<ResolvedConstraintPolicy> {
    const { values } = await this.config.resolve('constraint_policy', tenantId, plantId, lineId)
    const modes: ResolvedConstraintPolicy['modes'] = {}
    for (const c of CONSTRAINT_POLICIES) {
      const mode = constraintModeSchema.parse(values[`${c.constraintId}.mode`])
      const threshold = values[`${c.constraintId}.threshold`]
      modes[c.constraintId] = { mode, threshold: threshold != null ? Number(threshold) : null }
    }
    return { modes }
  }

  /** Resolved Autonomy Policy (global → tenant) — the learning gate reads this in place of the
   *  retired per-tenant `autonomy_config`. Always real-valued (the floor is the default). */
  async resolveAutonomy(tenantId: string): Promise<AutonomyPolicy> {
    const { values } = await this.config.resolve('autonomy', tenantId)
    return {
      tier1AutoThreshold: Number(values['tier1AutoThreshold']),
      wearBand: Number(values['wearBand']),
      snoozeConfDelta: Number(values['snoozeConfDelta']),
      snoozeUrgencyMinutes: Number(values['snoozeUrgencyMinutes']),
      boundedAuto: Boolean(values['boundedAuto']),
    }
  }

  /**
   * Resolved KPI / Metric Policy (plant → tenant → global). Reshapes the flat cascade into the
   * structured policy the dashboard + the actuals folds read: the configurable **On-Time measure**
   * (tolerance) and the per-KPI **threshold bands** (with their fixed direction). Default tolerance 0
   * reproduces the current On-Time behavior — parity holds until a tenant/plant overrides.
   */
  async resolveKpiPolicy(tenantId: string, plantId?: string): Promise<KpiPolicy> {
    const { values } = await this.config.resolve('kpi', tenantId, plantId)
    const thresholds = {} as Record<KpiThresholdKey, KpiThreshold>
    for (const m of KPI_THRESHOLD_METRICS) {
      const k = kpiBandFieldKeys(m.key)
      thresholds[m.key] = { direction: m.direction, green: Number(values[k.green]), amber: Number(values[k.amber]) }
    }
    return { onTime: { toleranceMinutes: Number(values['onTimeToleranceMinutes']) }, thresholds }
  }
}
