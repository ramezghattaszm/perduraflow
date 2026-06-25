import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  AutonomyConfigDto,
  AutonomyConfigUpdate,
  LearnedParameterDto,
  ParameterPredictionDto,
  PerformanceVarianceDto,
  ScorecardDto,
  SimulateActualsRequest,
  WorkforceCoverageDto,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)
const put = <T, B>(url: string, body: B) => apiClient.put<T>(url, body).then((r) => r.data)

/** All learned parameter overlays for the tenant (board panel + ml bars + wear flag). */
export function useLearnedParameters() {
  return useQuery({
    queryKey: QUERY_KEYS.learning.parameters(),
    queryFn: () => get<LearnedParameterDto[]>('/learning/parameters'),
  })
}

/** Performance variance for a version (board strip + Scorecard summary). */
export function useVariance(versionId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.variance(versionId ?? ''),
    queryFn: () => get<PerformanceVarianceDto>(`/scheduling/variance?versionId=${versionId}`),
    enabled: Boolean(versionId),
  })
}

/**
 * Per-version Service–Cost Scorecard (View 2). `versionId` omitted → latest committed;
 * `resourceId` drills to one line (plant-level when omitted).
 */
export function useScorecard(plantId: string | undefined, versionId?: string, resourceId?: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.scheduling.scorecard(plantId ?? '', versionId ?? ''), resourceId ?? ''],
    queryFn: () =>
      get<ScorecardDto>(
        `/scheduling/scorecard?plantId=${plantId}${versionId ? `&versionId=${versionId}` : ''}${resourceId ? `&resourceId=${resourceId}` : ''}`,
      ),
    enabled: Boolean(plantId),
  })
}

/** Workforce coverage grid + readiness + cert-gap proposals (View 3). */
export function useCoverage(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.workforce.coverage(plantId ?? ''),
    queryFn: () => get<WorkforceCoverageDto>(`/workforce/coverage?plantId=${plantId}`),
    enabled: Boolean(plantId),
  })
}

/** Confirm a cert-gap OT call-in proposal (D54, human-disposed). */
export function useConfirmCoverageProposal(plantId: string | undefined) {
  return useMutation({
    mutationFn: (proposalId: string) => post<{ confirmed: boolean }, undefined>(`/workforce/proposals/${proposalId}/confirm`, undefined),
    onSuccess: () => {
      if (plantId) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workforce.coverage(plantId) })
    },
  })
}

/** Demo-only simulator (SKIP-51): emit seeded actuals (+ optional drift) for a committed version. */
export function useSimulateActuals() {
  return useMutation({
    mutationFn: (req: SimulateActualsRequest) => post<{ emitted: number }, SimulateActualsRequest>('/dev/scheduling/simulate', req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.learning.parameters() })
      // Prefix match — covers every plant's predictions (the key now carries plantId).
      void queryClient.invalidateQueries({ queryKey: ['learning', 'predictions'] })
    },
  })
}

// --- phase 4: predictions + autonomy policy ----------------------------------

/**
 * Live parameter forecasts for a plant (Exception Queue + board flags, View 4). Plant-scoped at the
 * endpoint (`plantId` required), so it only runs once a plant is selected — never shows another plant's.
 */
export function usePredictions(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.learning.predictions(plantId ?? ''),
    queryFn: () => get<ParameterPredictionDto[]>(`/learning/predictions?plantId=${plantId}`),
    enabled: Boolean(plantId),
  })
}

const invalidatePredictions = () => {
  // Prefix match — invalidates predictions for every plant (the key now carries plantId).
  void queryClient.invalidateQueries({ queryKey: ['learning', 'predictions'] })
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.learning.parameters() })
}

/** Human-approve a queued prediction (applies the pre-adjust; ConfigureGuard). */
export function useApprovePrediction() {
  return useMutation({
    mutationFn: (id: string) => post<{ ok: boolean }, undefined>(`/learning/predictions/${id}/approve`, undefined),
    onSuccess: invalidatePredictions,
  })
}

/** Human-dismiss a queued prediction (no action taken; ConfigureGuard). */
export function useDismissPrediction() {
  return useMutation({
    mutationFn: (id: string) => post<{ ok: boolean }, undefined>(`/learning/predictions/${id}/dismiss`, undefined),
    onSuccess: invalidatePredictions,
  })
}

/** The tenant's autonomy config — the confidence threshold + tier modes (View 5). */
export function useAutonomyConfig() {
  return useQuery({
    queryKey: QUERY_KEYS.policy.autonomy(),
    queryFn: () => get<AutonomyConfigDto>('/policy/autonomy'),
  })
}

/** Set the autonomy config (ConfigureGuard, D42 audited). */
export function useUpdateAutonomyConfig() {
  return useMutation({
    mutationFn: (body: AutonomyConfigUpdate) => put<AutonomyConfigDto, AutonomyConfigUpdate>('/policy/autonomy', body),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.policy.autonomy(), data)
      invalidatePredictions()
    },
  })
}
