import { useMutation, useQuery } from '@tanstack/react-query'
import type { ConfigGroupKey, ConfigGroupView, ConfigValue } from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const put = <T, B>(url: string, body: B) => apiClient.put<T>(url, body).then((r) => r.data)
const del = <T>(url: string) => apiClient.delete<T>(url).then((r) => r.data)

const configKey = (group: ConfigGroupKey, plantId?: string) => ['config', group, plantId ?? null] as const

/**
 * The resolved cascade view for a config group (CONFIG-FRAMEWORK-DESIGN) — per-field effective
 * value, provenance (inherited/overridden), and the global/tenant/plant columns. `plantId` scopes
 * the resolution so the plant override participates; omit for tenant-level resolution.
 */
export function useConfigGroup(group: ConfigGroupKey, plantId?: string) {
  return useQuery({
    queryKey: configKey(group, plantId),
    queryFn: () => get<ConfigGroupView>(`/config/${group}${plantId ? `?plantId=${plantId}` : ''}`),
  })
}

type OverrideArgs = {
  group: ConfigGroupKey
  level: 'tenant' | 'plant'
  scopeId: string
  fields: Record<string, ConfigValue>
  /** The plant scope this view is resolved at (for cache invalidation), if any. */
  plantId?: string
}

/** Set a sparse override at a level (ConfigureGuard, audited). Refreshes the group view. */
export function useSetConfigOverride() {
  return useMutation({
    mutationFn: ({ group, level, scopeId, fields }: OverrideArgs) =>
      put<ConfigGroupView, { fields: Record<string, ConfigValue> }>(`/config/${group}/${level}/${scopeId}`, { fields }),
    onSuccess: (data, vars) => {
      queryClient.setQueryData(configKey(vars.group, vars.plantId), data)
      queryClient.invalidateQueries({ queryKey: ['config', vars.group] })
      // A reporting-window change re-scopes the continuous KPIs → refresh variance.
      queryClient.invalidateQueries({ queryKey: ['scheduling', 'variance'] })
    },
  })
}

type ResetArgs = { group: ConfigGroupKey; level: 'tenant' | 'plant'; scopeId: string; field?: string; plantId?: string }

/** Reset a field (or the whole level) to its parent. Refreshes the group view. */
export function useResetConfigOverride() {
  return useMutation({
    mutationFn: ({ group, level, scopeId, field }: ResetArgs) =>
      del<ConfigGroupView>(`/config/${group}/${level}/${scopeId}${field ? `?field=${field}` : ''}`),
    onSuccess: (data, vars) => {
      queryClient.setQueryData(configKey(vars.group, vars.plantId), data)
      queryClient.invalidateQueries({ queryKey: ['config', vars.group] })
      queryClient.invalidateQueries({ queryKey: ['scheduling', 'variance'] })
    },
  })
}
