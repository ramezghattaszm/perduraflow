import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  BaselineSource,
  ChangeSet,
  NarrationMode,
  PlanComparisonDto,
  ScheduleVersionDto,
  WhatIfNarrationDto,
  WhatIfResultDto,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)

/**
 * Evaluate a change-set → a ranked, costed option-set with structured rationale
 * (D55). Deterministic; nothing commits (that's {@link useApplyOption}).
 */
export function useWhatIf() {
  return useMutation({
    mutationFn: (vars: { plantId: string; changeSet: ChangeSet; baseVersionId?: string }) =>
      post<WhatIfResultDto, typeof vars>('/scheduling/what-if', vars),
  })
}

/** Fetch a stored what-if result by id (the phase-6 substrate read). */
export function useWhatIfResult(id: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.whatIf(id ?? ''),
    queryFn: () => get<WhatIfResultDto>(`/scheduling/what-if/${id}`),
    enabled: Boolean(id),
  })
}

/**
 * Render a what-if result's structured rationale into prose (A19). Async + never in
 * the commit path; a failure returns `status: 'unavailable'` (zero functional impact).
 */
export function useNarration() {
  return useMutation({
    mutationFn: (vars: { resultId: string; mode: NarrationMode; optionId?: string }) =>
      post<WhatIfNarrationDto, { mode: NarrationMode; optionId?: string }>(`/scheduling/what-if/${vars.resultId}/narrate`, {
        mode: vars.mode,
        optionId: vars.optionId,
      }),
  })
}

/** Live plan vs a baseline arm (D57); `emptyState` when no historical baseline exists. */
export function useBaseline(plantId: string | undefined, source: BaselineSource, resourceId?: string) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.baseline(plantId ?? '', source, resourceId ?? ''),
    queryFn: () =>
      get<PlanComparisonDto>(`/scheduling/baseline?plantId=${plantId}&source=${source}${resourceId ? `&resourceId=${resourceId}` : ''}`),
    enabled: Boolean(plantId),
  })
}

/**
 * Apply a chosen option → a new draft schedule version (D26 human action). Awaits
 * invalidation of the plant's versions so the new draft is in the list **before**
 * the caller selects it (otherwise the board's auto-select effect clobbers it back).
 */
export function useApplyOption() {
  return useMutation({
    mutationFn: (vars: { resultId: string; optionId: string }) =>
      post<ScheduleVersionDto, { optionId: string }>(`/admin/scheduling/what-if/${vars.resultId}/apply`, { optionId: vars.optionId }),
    onSuccess: (v) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.versions(v.plantId) }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.version(v.id) }),
      ]),
  })
}
