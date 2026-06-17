import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import type { NarrationMode, WhatIfNarrationDto, WhatIfOption } from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { LlmGateway } from '../llm/llm.gateway'
import { SchedulingRepository } from './scheduling.repository'
import { inputFor } from './whatif.narration'

/**
 * Narration service (phase 5, A19) — renders a what-if result's **structured
 * rationale** into prose via the LLM gateway, **translate-only**. It is **async,
 * non-blocking, and never in the commit path**: the option-set + structured
 * rationale already rendered and Apply is already live; this is called after. A
 * provider failure is caught and recorded as `unavailable` — zero functional
 * impact, the structured rationale remains the answer.
 */
@Injectable()
export class NarrationService {
  private readonly logger = new Logger('Narration')
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly llm: LlmGateway,
  ) {}

  /**
   * Narrate a stored what-if result (one option or the across-options summary).
   * @throws WHATIF_RESULT_NOT_FOUND the result id is unknown for the tenant
   */
  async narrate(tenantId: string, resultId: string, mode: NarrationMode, optionId?: string): Promise<WhatIfNarrationDto> {
    const result = await this.repo.findWhatIfResult(tenantId, resultId)
    if (!result) {
      throw new AppException(HttpStatus.NOT_FOUND, 'What-if result not found', ERROR_CODES.WHATIF_RESULT_NOT_FOUND)
    }
    const options = result.options as WhatIfOption[]
    const input = inputFor(mode, options, result.recommendedOptionId, optionId)

    try {
      const res = await this.llm.narrate(input)
      const row = await this.repo.createNarration({
        tenantId,
        resultId,
        optionId: optionId ?? null,
        mode,
        status: 'ready',
        prose: res.prose,
        model: res.model,
        promptVersion: res.promptVersion,
        provider: res.provider,
      })
      return {
        resultId,
        optionId: optionId ?? null,
        mode,
        status: 'ready',
        prose: res.prose,
        model: res.model,
        promptVersion: res.promptVersion,
        createdAt: row.createdAt.toISOString(),
      }
    } catch (err) {
      // Non-blocking: record the miss, return `unavailable`, never throw to the caller.
      this.logger.warn(`narration unavailable for ${resultId}: ${(err as Error).message}`)
      const row = await this.repo.createNarration({
        tenantId,
        resultId,
        optionId: optionId ?? null,
        mode,
        status: 'unavailable',
        prose: null,
        model: null,
        promptVersion: null,
        provider: null,
      })
      return { resultId, optionId: optionId ?? null, mode, status: 'unavailable', prose: null, model: null, promptVersion: null, createdAt: row.createdAt.toISOString() }
    }
  }
}
