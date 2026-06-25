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

    // Cache hit: a what-if result is immutable, so a prior `ready` narration at the
    // current prompt version is reusable — re-opening an option returns instantly
    // without re-calling the model. Regeneration only happens when the prompt changes.
    const promptVersion = this.llm.narrationPromptVersion()
    const cached = await this.repo.findReadyNarration(tenantId, resultId, mode, optionId ?? null, promptVersion)
    // Only reuse a cached narration that actually has prose — a prior empty/blank `ready` (e.g. the
    // model returned no content) must NOT be served as the answer; fall through and regenerate.
    if (cached && cached.prose && cached.prose.trim()) {
      return {
        resultId,
        optionId: optionId ?? null,
        mode,
        status: 'ready',
        prose: cached.prose,
        model: cached.model,
        promptVersion: cached.promptVersion,
        createdAt: cached.createdAt.toISOString(),
      }
    }

    try {
      const res = await this.llm.narrate(input)
      // Empty prose is a soft failure, not a `ready` answer: caching it `ready` would render a blank
      // box forever (it's translate-only — a no-op narration has no value). Treat it as `unavailable`
      // so the UI shows the honest line and the next open retries (unavailable isn't cache-served).
      if (!res.prose || !res.prose.trim()) {
        throw new Error('narration returned empty prose')
      }
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
