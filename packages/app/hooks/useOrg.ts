import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  CalendarDto,
  CreateCalendarRequest,
  CreateCustomerRequest,
  CreatePlantGroupRequest,
  CreatePlantRequest,
  CreateProgramRequest,
  CustomerDto,
  PlantDto,
  PlantGroupDto,
  ProgramDto,
  UpdateCalendarRequest,
  UpdateCustomerRequest,
  UpdatePlantGroupRequest,
  UpdatePlantRequest,
  UpdateProgramRequest,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)
const patch = <T, B>(url: string, body: B) => apiClient.patch<T>(url, body).then((r) => r.data)

// --- plants ------------------------------------------------------------------
/** Lists the tenant's plants (`GET /org/plants`). */
export function usePlants() {
  return useQuery({ queryKey: QUERY_KEYS.org.plants(), queryFn: () => get<PlantDto[]>('/org/plants') })
}
/** Create/update a plant; invalidates the plants list on success. */
export function usePlantMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.org.plants() })
  const create = useMutation({
    mutationFn: (b: CreatePlantRequest) => post<PlantDto, CreatePlantRequest>('/admin/org/plants', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePlantRequest }) =>
      patch<PlantDto, UpdatePlantRequest>(`/admin/org/plants/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- plant groups ------------------------------------------------------------
/** Lists the tenant's plant groups (`GET /org/plant-groups`). */
export function usePlantGroups() {
  return useQuery({
    queryKey: QUERY_KEYS.org.plantGroups(),
    queryFn: () => get<PlantGroupDto[]>('/org/plant-groups'),
  })
}
/** Create/update a plant group; invalidates the list on success. */
export function usePlantGroupMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.org.plantGroups() })
  const create = useMutation({
    mutationFn: (b: CreatePlantGroupRequest) =>
      post<PlantGroupDto, CreatePlantGroupRequest>('/admin/org/plant-groups', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePlantGroupRequest }) =>
      patch<PlantGroupDto, UpdatePlantGroupRequest>(`/admin/org/plant-groups/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- customers ---------------------------------------------------------------
/** Lists the tenant's customers (`GET /org/customers`). */
export function useCustomers() {
  return useQuery({ queryKey: QUERY_KEYS.org.customers(), queryFn: () => get<CustomerDto[]>('/org/customers') })
}
/** Create/update a customer; invalidates the list on success. */
export function useCustomerMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.org.customers() })
  const create = useMutation({
    mutationFn: (b: CreateCustomerRequest) => post<CustomerDto, CreateCustomerRequest>('/admin/org/customers', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCustomerRequest }) =>
      patch<CustomerDto, UpdateCustomerRequest>(`/admin/org/customers/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- programs ----------------------------------------------------------------
/** Lists the tenant's programs (`GET /org/programs`). */
export function usePrograms() {
  return useQuery({ queryKey: QUERY_KEYS.org.programs(), queryFn: () => get<ProgramDto[]>('/org/programs') })
}
/** Create/update a program; invalidates the list on success. */
export function useProgramMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.org.programs() })
  const create = useMutation({
    mutationFn: (b: CreateProgramRequest) => post<ProgramDto, CreateProgramRequest>('/admin/org/programs', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProgramRequest }) =>
      patch<ProgramDto, UpdateProgramRequest>(`/admin/org/programs/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}

// --- calendars ---------------------------------------------------------------
/** Lists the tenant's calendars (`GET /org/calendars`). */
export function useCalendars() {
  return useQuery({ queryKey: QUERY_KEYS.org.calendars(), queryFn: () => get<CalendarDto[]>('/org/calendars') })
}
/** Create/update a calendar; invalidates the list on success. */
export function useCalendarMutations() {
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.org.calendars() })
  const create = useMutation({
    mutationFn: (b: CreateCalendarRequest) => post<CalendarDto, CreateCalendarRequest>('/admin/org/calendars', b),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCalendarRequest }) =>
      patch<CalendarDto, UpdateCalendarRequest>(`/admin/org/calendars/${id}`, body),
    onSuccess: invalidate,
  })
  return { create, update }
}
