/** Centralized React Query keys (UI-ARCHITECTURE.md §7). */
export const QUERY_KEYS = {
  me: () => ['me'] as const,
  org: {
    plants: () => ['org', 'plants'] as const,
    plantGroups: () => ['org', 'plant-groups'] as const,
    customers: () => ['org', 'customers'] as const,
    programs: () => ['org', 'programs'] as const,
    calendars: () => ['org', 'calendars'] as const,
  },
  admin: {
    users: () => ['admin', 'users'] as const,
    roles: () => ['admin', 'roles'] as const,
    approvalTiers: () => ['admin', 'approval-tiers'] as const,
  },
  masterData: {
    parts: () => ['master-data', 'parts'] as const,
    resources: () => ['master-data', 'resources'] as const,
    resourceGroups: () => ['master-data', 'resource-groups'] as const,
    routings: () => ['master-data', 'routings'] as const,
    routing: (id: string) => ['master-data', 'routings', id] as const,
    certifications: () => ['master-data', 'certifications'] as const,
    operators: () => ['master-data', 'operators'] as const,
  },
}
