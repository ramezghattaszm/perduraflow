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
  scheduling: {
    versions: (plantId: string) => ['scheduling', 'versions', plantId] as const,
    version: (id: string) => ['scheduling', 'version', id] as const,
    demand: (plantId: string) => ['scheduling', 'demand', plantId] as const,
    resources: (plantId: string) => ['scheduling', 'resources', plantId] as const,
    variance: (versionId: string) => ['scheduling', 'variance', versionId] as const,
    scorecard: (plantId: string, versionId: string) => ['scheduling', 'scorecard', plantId, versionId] as const,
  },
  learning: {
    parameters: () => ['learning', 'parameters'] as const,
    predictions: () => ['learning', 'predictions'] as const,
  },
  workforce: {
    coverage: (plantId: string) => ['workforce', 'coverage', plantId] as const,
  },
  policy: {
    autonomy: () => ['policy', 'autonomy'] as const,
  },
}
