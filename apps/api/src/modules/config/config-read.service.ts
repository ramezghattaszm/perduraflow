import { Injectable } from '@nestjs/common'
import { CONFIG_READ_CONTRACT, type ConfigReadContract, type ReportingPolicy } from '@perduraflow/contracts'
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
}
