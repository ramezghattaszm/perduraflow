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
}
