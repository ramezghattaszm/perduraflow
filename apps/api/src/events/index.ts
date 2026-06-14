/**
 * Inter-module domain event names (constants, never inline strings). Cross-module
 * events flow through the EventBus coordinator + its local in-memory provider
 * (api-spec §0 O5 / SKIP-05) — never raw EventEmitter2 across a boundary.
 * Intra-module side effects may still use EventEmitter2.
 */
export const EVENTS = {
  USER_REGISTERED: 'auth.user.registered',
  USER_VERIFIED: 'auth.user.verified',
  USER_CREATED: 'auth.user.created',
  ROLE_CREATED: 'auth.role.created',
  PLANT_CREATED: 'org.plant.created',
  PLANT_GROUP_CREATED: 'org.plant_group.created',
  CUSTOMER_CREATED: 'org.customer.created',
  PROGRAM_CREATED: 'org.program.created',
  CALENDAR_CREATED: 'org.calendar.created',
  // master-data module (phase 1)
  PART_CREATED: 'master_data.part.created',
  RESOURCE_CREATED: 'master_data.resource.created',
  RESOURCE_GROUP_CREATED: 'master_data.resource_group.created',
  ROUTING_CREATED: 'master_data.routing.created',
  CERTIFICATION_CREATED: 'master_data.certification.created',
  OPERATOR_CREATED: 'master_data.operator.created',
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

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

export interface OrgEntityCreatedPayload {
  id: string
  tenantId: string
  name: string
}
