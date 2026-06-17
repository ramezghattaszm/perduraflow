import { Global, Module } from '@nestjs/common'
import { LLM_ADAPTERS, type LlmProviderAdapter } from './interfaces/llm-provider.interface'
import { LLM_GATEWAY, LlmGateway } from './llm.gateway'
import { AnthropicLlmProvider } from './providers/anthropic-llm.provider'
import { OpenAiCompatLlmProvider } from './providers/openai-compat-llm.provider'
import { RecordedLlmProvider } from './providers/recorded-llm.provider'

/**
 * LLM narration gateway module (phase 5, A19/A15) — a `@Global` kernel coordinator
 * any module consumes via {@link LlmGateway}. **All** thin adapters are registered
 * (`recorded`, `anthropic`, `groq`); the **smart gateway** selects the active one by
 * env + preset and owns selection/retries/backoff/error policy (and the phase-6 tool
 * loop). Adding a provider = a new adapter in {@link LLM_ADAPTERS}; nothing else
 * changes. `LlmGateway` is also exposed under {@link LLM_GATEWAY} for contract-token
 * consumers.
 */
@Global()
@Module({
  providers: [
    RecordedLlmProvider,
    AnthropicLlmProvider,
    OpenAiCompatLlmProvider,
    {
      provide: LLM_ADAPTERS,
      useFactory: (...adapters: LlmProviderAdapter[]) => adapters,
      inject: [RecordedLlmProvider, AnthropicLlmProvider, OpenAiCompatLlmProvider],
    },
    LlmGateway,
    { provide: LLM_GATEWAY, useExisting: LlmGateway },
  ],
  exports: [LlmGateway, LLM_GATEWAY],
})
export class LlmModule {}
