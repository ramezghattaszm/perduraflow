import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  AdminUser,
  ApprovalTier,
  CreateRoleRequest,
  CreateUserRequest,
  Role,
  UpdateRoleRequest,
  UpdateUserRequest,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)

// --- users -------------------------------------------------------------------
/** Lists the tenant's users (`GET /admin/users`). */
export function useAdminUsers() {
  return useQuery({ queryKey: QUERY_KEYS.admin.users(), queryFn: () => get<AdminUser[]>('/admin/users') })
}
/** Create/update a user; invalidates the users list on success. */
export function useUserMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.admin.users() })
  const create = useMutation({
    mutationFn: (b: CreateUserRequest) => apiClient.post<AdminUser>('/admin/users', b).then((r) => r.data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserRequest }) =>
      apiClient.patch<AdminUser>(`/admin/users/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- roles -------------------------------------------------------------------
/** Lists the tenant's roles (`GET /admin/roles`). */
export function useRoles() {
  return useQuery({ queryKey: QUERY_KEYS.admin.roles(), queryFn: () => get<Role[]>('/admin/roles') })
}
/** Create/update a role; invalidates the roles list on success. */
export function useRoleMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.admin.roles() })
  const create = useMutation({
    mutationFn: (b: CreateRoleRequest) => apiClient.post<Role>('/admin/roles', b).then((r) => r.data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoleRequest }) =>
      apiClient.patch<Role>(`/admin/roles/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- approval tiers ----------------------------------------------------------
/** Lists the tenant's approval tiers (`GET /admin/approval-tiers`). */
export function useApprovalTiers() {
  return useQuery({
    queryKey: QUERY_KEYS.admin.approvalTiers(),
    queryFn: () => get<ApprovalTier[]>('/admin/approval-tiers'),
  })
}
