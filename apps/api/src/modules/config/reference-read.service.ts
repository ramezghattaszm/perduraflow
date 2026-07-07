import { Injectable } from '@nestjs/common'
import {
  REFERENCE_READ_CONTRACT,
  type ReferenceReadContract,
  type ReferenceSetSummaryDto,
  type ResolvedReferenceSetDto,
} from '@perduraflow/contracts'
import { REFERENCE_SETS } from './config.refsets'
import { ReferenceSetService } from './reference-set.service'

/** DI token for the published `reference.read 1.0` interface (consumed cross-module + resolved via the O7 binding). */
export const REFERENCE_READ = Symbol('REFERENCE_READ')

/**
 * In-process implementation of `reference.read 1.0` — the resolved, suppression-applied reference sets
 * consumers (and admin pickers) read for their scope. Wraps {@link ReferenceSetService} (arg-order + DTO
 * adaptation), mirroring how {@link ConfigReadService} wraps {@link ConfigService}. Registered as a binding
 * counterpart at the composition root (O7), resolved like `masterdata.read`.
 */
@Injectable()
export class ReferenceReadService implements ReferenceReadContract {
  readonly contract = REFERENCE_READ_CONTRACT

  constructor(private readonly refset: ReferenceSetService) {}

  /** The resolved members for a set + scope (`platform → tenant → plant`, suppression applied). */
  async resolveReferenceSet(tenantId: string, setKey: string, opts?: { plantId?: string }): Promise<ResolvedReferenceSetDto> {
    const resolved = await this.refset.resolveReferenceSet(setKey, tenantId, opts?.plantId)
    return { setKey: resolved.setKey, members: resolved.members.map((m) => ({ key: m.key, metadata: m.metadata ?? {} })) }
  }

  /** The registered reference sets (summaries) — tenant-agnostic (the registry is platform-global). */
  async listReferenceSets(): Promise<ReferenceSetSummaryDto[]> {
    return Object.values(REFERENCE_SETS).map((d) => ({
      setKey: d.setKey,
      declaredLevels: d.declaredLevels,
      resolutionMode: d.resolutionMode,
    }))
  }
}
