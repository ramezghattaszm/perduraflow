/** Centralized React Query keys (UI-ARCHITECTURE.md §7). */
export const QUERY_KEYS = {
  me: () => ['me'] as const,
  example: {
    list: (cursor?: string) => ['example', 'list', cursor ?? null] as const,
    one: (id: string) => ['example', id] as const,
  },
  notifications: () => ['notifications'] as const,
}
