/**
 * Domain events. Modules communicate side effects through EventEmitter2 rather
 * than importing each other (API-ARCHITECTURE.md §3). Event names are constants;
 * payloads are typed.
 */
export const EVENTS = {
  USER_REGISTERED: 'user.registered',
  USER_VERIFIED: 'user.verified',
  EXAMPLE_CREATED: 'example.created',
  EXAMPLE_DELETED: 'example.deleted',
} as const

export interface UserRegisteredPayload {
  userId: string
  email: string
  name: string
}

export interface UserVerifiedPayload {
  userId: string
  email: string
  name: string
}

export interface ExampleEventPayload {
  exampleId: string
  ownerId: string
  tenantId: string
}
