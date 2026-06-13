import { ulid } from 'ulid'

/**
 * One ID strategy across the whole schema: app-layer generated ULIDs stored in
 * `text` primary/foreign keys (API-ARCHITECTURE.md §2). Never serial/integer.
 */
export { ulid }
export const generateId = (): string => ulid()
