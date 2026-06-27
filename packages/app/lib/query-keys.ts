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
    downtime: (plantId: string) => ['master-data', 'downtime', plantId] as const,
  },
  scheduling: {
    versions: (plantId: string) => ['scheduling', 'versions', plantId] as const,
    version: (id: string) => ['scheduling', 'version', id] as const,
    demand: (plantId: string) => ['scheduling', 'demand', plantId] as const,
    resources: (plantId: string) => ['scheduling', 'resources', plantId] as const,
    materialAvailability: (plantId: string) => ['scheduling', 'material-availability', plantId] as const,
    materialConditions: (plantId: string, versionId: string) => ['scheduling', 'material-conditions', plantId, versionId] as const,
    operatorAssignments: (plantId: string) => ['scheduling', 'operator-assignments', plantId] as const,
    variance: (versionId: string) => ['scheduling', 'variance', versionId] as const,
    scorecard: (plantId: string, versionId: string) => ['scheduling', 'scorecard', plantId, versionId] as const,
    workList: (plantId: string, versionId: string, week = '') =>
      ['scheduling', 'work-list', plantId, versionId, week] as const,
    whatIf: (id: string) => ['scheduling', 'whatif', id] as const,
    narration: (resultId: string, mode: string, optionId: string) => ['scheduling', 'narration', resultId, mode, optionId] as const,
    baseline: (plantId: string, source: string, resourceId: string) => ['scheduling', 'baseline', plantId, source, resourceId] as const,
    conversations: () => ['scheduling', 'conversations'] as const,
    conversation: (id: string) => ['scheduling', 'conversation', id] as const,
  },
  learning: {
    parameters: () => ['learning', 'parameters'] as const,
    predictions: (plantId: string) => ['learning', 'predictions', plantId] as const,
  },
  workforce: {
    coverage: (plantId: string) => ['workforce', 'coverage', plantId] as const,
  },
  policy: {
    autonomy: () => ['policy', 'autonomy'] as const,
  },
}
