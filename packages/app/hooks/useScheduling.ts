import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  DemandInputDto,
  MaterialAvailabilityDto,
  MaterialConditionDto,
  ResourceDto,
  ScheduleVersionDetailDto,
  ScheduleVersionDto,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)
const patch = <T, B>(url: string, body: B) => apiClient.patch<T>(url, body).then((r) => r.data)

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
