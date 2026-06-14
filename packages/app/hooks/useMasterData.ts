import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  CertificationDto,
  CreateCertificationRequest,
  CreateOperatorRequest,
  CreatePartRequest,
  CreateResourceGroupRequest,
  CreateResourceRequest,
  CreateRoutingRequest,
  OperatorDto,
  PartDto,
  ResourceDto,
  ResourceGroupDto,
  RoutingDto,
  SetOperatorQualificationRequest,
  UpdateCertificationRequest,
  UpdateOperatorRequest,
  UpdatePartRequest,
  UpdateResourceGroupRequest,
  UpdateResourceRequest,
  UpdateRoutingRequest,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)
const patch = <T, B>(url: string, body: B) => apiClient.patch<T>(url, body).then((r) => r.data)

// --- parts -------------------------------------------------------------------
/** Lists the tenant's parts (`GET /master-data/parts`). */
export function useParts() {
  return useQuery({ queryKey: QUERY_KEYS.masterData.parts(), queryFn: () => get<PartDto[]>('/master-data/parts') })
}
/** Create/update a part; invalidates the parts list on success. */
export function usePartMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.parts() })
  const create = useMutation({
    mutationFn: (b: CreatePartRequest) => post<PartDto, CreatePartRequest>('/admin/master-data/parts', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePartRequest }) =>
      patch<PartDto, UpdatePartRequest>(`/admin/master-data/parts/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- resources ---------------------------------------------------------------
/** Lists the tenant's resources (`GET /master-data/resources`). */
export function useResources() {
  return useQuery({ queryKey: QUERY_KEYS.masterData.resources(), queryFn: () => get<ResourceDto[]>('/master-data/resources') })
}
/** Create/update a resource; invalidates the resources list on success. */
export function useResourceMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.resources() })
  const create = useMutation({
    mutationFn: (b: CreateResourceRequest) => post<ResourceDto, CreateResourceRequest>('/admin/master-data/resources', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateResourceRequest }) =>
      patch<ResourceDto, UpdateResourceRequest>(`/admin/master-data/resources/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- resource groups ---------------------------------------------------------
/** Lists the tenant's resource groups (`GET /master-data/resource-groups`). */
export function useResourceGroups() {
  return useQuery({
    queryKey: QUERY_KEYS.masterData.resourceGroups(),
    queryFn: () => get<ResourceGroupDto[]>('/master-data/resource-groups'),
  })
}
/** Create/update a resource group; invalidates the list on success. */
export function useResourceGroupMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.resourceGroups() })
  const create = useMutation({
    mutationFn: (b: CreateResourceGroupRequest) =>
      post<ResourceGroupDto, CreateResourceGroupRequest>('/admin/master-data/resource-groups', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateResourceGroupRequest }) =>
      patch<ResourceGroupDto, UpdateResourceGroupRequest>(`/admin/master-data/resource-groups/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- routings ----------------------------------------------------------------
/** Lists the tenant's routings, each with operations (`GET /master-data/routings`). */
export function useRoutings() {
  return useQuery({ queryKey: QUERY_KEYS.masterData.routings(), queryFn: () => get<RoutingDto[]>('/master-data/routings') })
}
/** One routing with its ordered operations (`GET /master-data/routings/:id`). */
export function useRouting(id: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.masterData.routing(id ?? ''),
    queryFn: () => get<RoutingDto>(`/master-data/routings/${id}`),
    enabled: Boolean(id),
  })
}
/** Create/update a routing (operations replaced on update); invalidates list + the routing. */
export function useRoutingMutations() {
  const invalidate = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.routings() })
    if (id) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.routing(id) })
  }
  const create = useMutation({
    mutationFn: (b: CreateRoutingRequest) => post<RoutingDto, CreateRoutingRequest>('/admin/master-data/routings', b),
    onSuccess: (r) => invalidate(r.id),
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoutingRequest }) =>
      patch<RoutingDto, UpdateRoutingRequest>(`/admin/master-data/routings/${id}`, body),
    onSuccess: (r) => invalidate(r.id),
  })
  return { create, update }
}

// --- certifications ----------------------------------------------------------
/** Lists the tenant's certifications (`GET /master-data/certifications`). */
export function useCertifications() {
  return useQuery({
    queryKey: QUERY_KEYS.masterData.certifications(),
    queryFn: () => get<CertificationDto[]>('/master-data/certifications'),
  })
}
/** Create/update a certification; invalidates the list on success. */
export function useCertificationMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.certifications() })
  const create = useMutation({
    mutationFn: (b: CreateCertificationRequest) =>
      post<CertificationDto, CreateCertificationRequest>('/admin/master-data/certifications', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCertificationRequest }) =>
      patch<CertificationDto, UpdateCertificationRequest>(`/admin/master-data/certifications/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- operators + qualifications ----------------------------------------------
/** Lists the tenant's operators with held certification ids (`GET /master-data/operators`). */
export function useOperators() {
  return useQuery({ queryKey: QUERY_KEYS.masterData.operators(), queryFn: () => get<OperatorDto[]>('/master-data/operators') })
}
/** Create/update an operator; invalidates the list on success. */
export function useOperatorMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.operators() })
  const create = useMutation({
    mutationFn: (b: CreateOperatorRequest) => post<OperatorDto, CreateOperatorRequest>('/admin/master-data/operators', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperatorRequest }) =>
      patch<OperatorDto, UpdateOperatorRequest>(`/admin/master-data/operators/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}
/** Toggles one operator×certification cell (QualificationMatrix, FS6); invalidates operators. */
export function useSetOperatorQualification() {
  return useMutation({
    mutationFn: ({ operatorId, body }: { operatorId: string; body: SetOperatorQualificationRequest }) =>
      patch<OperatorDto, SetOperatorQualificationRequest>(`/admin/master-data/operators/${operatorId}/qualifications`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData.operators() }),
  })
}
