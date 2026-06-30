import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  DemandExceptionDto,
  DemandInputDto,
  KpiDashboardDto,
  MaterialAvailabilityDto,
  MaterialConditionDto,
  ResourceDto,
  ResourceOperatorAssignmentDto,
  ScheduleVersionDetailDto,
  ScheduleVersionDto,
  WorkListResponseDto,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)
const patch = <T, B>(url: string, body: B) => apiClient.patch<T>(url, body).then((r) => r.data)
const del = <T>(url: string) => apiClient.delete<T>(url).then((r) => r.data)

/**
 * The plant's schedule versions, newest first (board selector). Enabled once a plant
 * is chosen. `refetchOnMount: 'always'` so entering the board reflects any new draft /
 * committed version (e.g. one applied elsewhere) without a manual refresh, despite the
 * 60s staleTime.
 */
export function useScheduleVersions(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.versions(plantId ?? ''),
    queryFn: () => get<ScheduleVersionDto[]>(`/scheduling/versions?plantId=${plantId}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/** One version's board payload (header + run + ordered operations). */
export function useScheduleVersion(id: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.version(id ?? ''),
    queryFn: () => get<ScheduleVersionDetailDto>(`/scheduling/versions/${id}`),
    enabled: Boolean(id),
  })
}

/**
 * The plant's resources (board rows), via the bound `masterdata.read`. Drives the
 * board's **line-down condition** (a resource's `status`), so `refetchOnMount: 'always'`
 * — entering the board picks up a line set down elsewhere without a manual refresh.
 */
export function useScheduleResources(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.resources(plantId ?? ''),
    queryFn: () => get<ResourceDto[]>(`/scheduling/resources?plantId=${plantId}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/**
 * The plant's seeded demand (read-only context). Drives the board's **demand-change
 * condition** (qty vs the committed plan), so `refetchOnMount: 'always'`.
 */
export function useScheduleDemand(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.demand(plantId ?? ''),
    queryFn: () => get<DemandInputDto[]>(`/scheduling/demand?plantId=${plantId}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/**
 * The plant's Work List (D-worklist): every order with a computed status + status rollup counts.
 * Single source the Work List screen + the exception queue (filtered to at-risk) both read, so the
 * at-risk count reconciles. `versionId` optional → the API defaults to the plant's committed version.
 * `refetchOnMount: 'always'` so it reflects a re-solve / new actuals on entry.
 */
export function useWorkList(plantId: string | undefined, versionId?: string, week?: string) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.workList(plantId ?? '', versionId ?? '', week ?? ''),
    queryFn: () =>
      get<WorkListResponseDto>(
        `/scheduling/work-list?plantId=${plantId}${versionId ? `&versionId=${versionId}` : ''}${week ? `&week=${week}` : ''}`,
      ),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/**
 * Post-commit demand changes classified absorbed vs at-risk (same what-if the board previews). The
 * Exception Queue reads the `absorbed` ones into its auto-handled bucket — the demand-side complement
 * of a Tier-1 wear auto-commit. `refetchOnMount: 'always'` so it reflects a just-made demand change.
 */
export function useDemandExceptions(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.demandExceptions(plantId ?? ''),
    queryFn: () => get<DemandExceptionDto[]>(`/scheduling/demand-exceptions?plantId=${plantId}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/**
 * The 902 performance dashboard for a plant — current-value KPI tiles (with cascade-resolved
 * threshold status) + trends, over the reporting window. Enabled once a plant is chosen.
 */
export function useKpiDashboard(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.kpiDashboard(plantId ?? ''),
    queryFn: () => get<KpiDashboardDto>(`/scheduling/dashboard?plantId=${plantId}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/** The plant's buy-component availability (§4.8) — the scenario launcher's component dropdown. */
export function useMaterialAvailability(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.materialAvailability(plantId ?? ''),
    queryFn: () => get<MaterialAvailabilityDto[]>(`/scheduling/material-availability?plantId=${plantId}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/**
 * Detected material conditions (D36) — components whose availability gates committed ops.
 * Drives the board's material condition card (plan-relative); `refetchOnMount: 'always'`.
 */
export function useMaterialConditions(plantId: string | undefined, versionId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.materialConditions(plantId ?? '', versionId ?? ''),
    queryFn: () => get<MaterialConditionDto[]>(`/scheduling/material-conditions?plantId=${plantId}${versionId ? `&versionId=${versionId}` : ''}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/**
 * **Dev scenario launcher** — set a buy-component's availability date (`PATCH
 * /dev/scheduling/material/:componentPartId`). Mutates the §4.8 material data only; the board
 * detects the gated condition. Invalidates the plant's availability + condition queries.
 */
export function useSetMaterialAvailability(plantId: string | undefined) {
  return useMutation({
    mutationFn: ({ componentPartId, availableAt }: { componentPartId: string; availableAt: string }) =>
      patch<{ componentPartId: string; availableAt: string }, { plantId: string; availableAt: string }>(
        `/dev/scheduling/material/${componentPartId}`,
        { plantId: plantId ?? '', availableAt },
      ),
    onSuccess: () => {
      if (!plantId) return
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.materialAvailability(plantId) })
      void queryClient.invalidateQueries({ queryKey: ['scheduling', 'material-conditions', plantId] })
    },
  })
}

/** The plant's pinned resource↔operator assignments (§4.8 performance input, C5) — launcher view. */
export function useResourceOperatorAssignments(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.operatorAssignments(plantId ?? ''),
    queryFn: () => get<ResourceOperatorAssignmentDto[]>(`/scheduling/operator-assignments?plantId=${plantId}`),
    enabled: Boolean(plantId),
    refetchOnMount: 'always',
  })
}

/**
 * **Dev scenario launcher** — pin/swap the operator running a line (`PATCH
 * /dev/scheduling/operator-assignment/:resourceId`, C5). Mutates the §4.8 assignment only; a
 * re-solve reflects the new operator's performanceFactor on that line's run time. (The factor
 * itself is changed via the master-data operator update — it lives on the operator.)
 */
export function useSetResourceOperatorAssignment(plantId: string | undefined) {
  return useMutation({
    mutationFn: ({ resourceId, operatorId }: { resourceId: string; operatorId: string }) =>
      patch<{ resourceId: string; operatorId: string }, { plantId: string; operatorId: string; effectiveFrom: null; effectiveTo: null }>(
        `/dev/scheduling/operator-assignment/${resourceId}`,
        { plantId: plantId ?? '', operatorId, effectiveFrom: null, effectiveTo: null },
      ),
    onSuccess: () => {
      if (!plantId) return
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.operatorAssignments(plantId) })
    },
  })
}

/**
 * **Planner lever (C5)** — assign/switch the operator on a resource (`POST
 * /admin/scheduling/operator-assignments`, product, both guards). Resource-grain + time-windowed,
 * replace-open per resource. The engine reacts on the next re-solve (no auto-solve). Invalidates the
 * plant's assignments so the lane reflects the new operator.
 */
export function useAssignOperator(plantId: string | undefined) {
  return useMutation({
    mutationFn: (body: { resourceId: string; operatorId: string; effectiveFrom?: string | null; effectiveTo?: string | null }) =>
      post<ResourceOperatorAssignmentDto, { plantId: string; resourceId: string; operatorId: string; effectiveFrom: string | null; effectiveTo: string | null }>(
        '/admin/scheduling/operator-assignments',
        { plantId: plantId ?? '', resourceId: body.resourceId, operatorId: body.operatorId, effectiveFrom: body.effectiveFrom ?? null, effectiveTo: body.effectiveTo ?? null },
      ),
    onSuccess: () => {
      if (plantId) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.operatorAssignments(plantId) })
    },
  })
}

/** Unassign an operator from a resource (`DELETE /admin/scheduling/operator-assignments/:id`) — the
 *  line reverts to standard on the next re-solve. Invalidates the plant's assignments. */
export function useUnassignOperator(plantId: string | undefined) {
  return useMutation({
    mutationFn: (id: string) => del<void>(`/admin/scheduling/operator-assignments/${id}`),
    onSuccess: () => {
      if (plantId) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.operatorAssignments(plantId) })
    },
  })
}

/** Runs the deterministic sequencer for a plant → a new `draft` version; invalidates the version list. */
export function useSolveSchedule() {
  return useMutation({
    mutationFn: (plantId: string) =>
      post<ScheduleVersionDto, { plantId: string }>('/admin/scheduling/solve', { plantId }),
    onSuccess: (v) => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.versions(v.plantId) }),
  })
}

/** Promotes a `draft` version to `committed` (supersedes prior); invalidates list + the version. */
export function useCommitSchedule() {
  return useMutation({
    mutationFn: (id: string) => post<ScheduleVersionDto, undefined>(`/admin/scheduling/versions/${id}/commit`, undefined),
    onSuccess: (v) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.versions(v.plantId) })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.version(v.id) })
    },
  })
}

/**
 * Soft-deletes a **draft** version (`DELETE /admin/scheduling/versions/:id`, status → discarded).
 * Draft-only — the API rejects committed/superseded (immutable record). Invalidates the plant's
 * version list (the discarded draft drops out) + the version query.
 */
export function useDiscardDraft() {
  return useMutation({
    mutationFn: (id: string) => del<ScheduleVersionDto>(`/admin/scheduling/versions/${id}`),
    onSuccess: (v) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.versions(v.plantId) })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.version(v.id) })
    },
  })
}

/**
 * **Dev scenario launcher** — persistently change an order's quantity (`PATCH
 * /dev/scheduling/demand/:id`). Mutates the seeded demand so a re-solve reflects it;
 * invalidates the plant's demand list. Restored by `demo:reset`.
 */
export function useUpdateDemandQty() {
  return useMutation({
    mutationFn: ({ demandLineId, requiredQty }: { demandLineId: string; requiredQty: number }) =>
      patch<DemandInputDto, { requiredQty: number }>(`/dev/scheduling/demand/${demandLineId}`, { requiredQty }),
    onSuccess: (d) => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.demand(d.plantId) }),
  })
}
