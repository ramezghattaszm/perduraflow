import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  DemandInputDto,
  ResourceDto,
  ScheduleVersionDetailDto,
  ScheduleVersionDto,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)

/** The plant's schedule versions, newest first (board selector). Enabled once a plant is chosen. */
export function useScheduleVersions(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.versions(plantId ?? ''),
    queryFn: () => get<ScheduleVersionDto[]>(`/scheduling/versions?plantId=${plantId}`),
    enabled: Boolean(plantId),
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

/** The plant's resources (board rows), via the bound `masterdata.read`. */
export function useScheduleResources(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.resources(plantId ?? ''),
    queryFn: () => get<ResourceDto[]>(`/scheduling/resources?plantId=${plantId}`),
    enabled: Boolean(plantId),
  })
}

/** The plant's seeded demand (read-only context). */
export function useScheduleDemand(plantId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.demand(plantId ?? ''),
    queryFn: () => get<DemandInputDto[]>(`/scheduling/demand?plantId=${plantId}`),
    enabled: Boolean(plantId),
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
