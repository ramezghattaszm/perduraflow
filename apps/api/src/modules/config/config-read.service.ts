import { Injectable } from '@nestjs/common'
import {
  CONFIG_READ_CONTRACT,
  type ConfigReadContract,
  OBJECTIVE_DEFAULT_VERSION,
  type ObjectiveWeights,
  type ReportingPolicy,
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
  async resolveObjective(tenantId: string, plantId?: string): Promise<{ weights: ObjectiveWeights; version: string }> {
    const { values, provenance, revisions } = await this.config.resolve('objective', tenantId, plantId)
    const weights = {
      lateness: Number(values['lateness']),
      changeover: Number(values['changeover']),
      overtime: Number(values['overtime']),
      inventory: Number(values['inventory']),
      displacement: Number(values['displacement']),
      cost: Number(values['cost']),
    }
    const levels = Object.values(provenance)
    const version = levels.includes('plant')
      ? `obj:p${revisions.plant ?? 0}`
      : levels.includes('tenant')
        ? `obj:t${revisions.tenant ?? 0}`
        : OBJECTIVE_DEFAULT_VERSION
    return { weights, version }
  }
}
