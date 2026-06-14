/**
 * EventBus provider contract (A4 / SKIP-05). The coordinator owns envelope shape,
 * event-name constants, and publish audit; the provider delegates only the
 * transport primitives. The demo binds the local in-memory provider; a
 * Kafka-protocol provider later implements the same interface with no change to
 * the coordinator or any publisher/subscriber.
 */
export const EVENT_BUS_PROVIDER = Symbol('EVENT_BUS_PROVIDER')

/** A published event with its coordinator-owned envelope. */
export interface EventEnvelope<T = unknown> {
  /** ULID of this envelope. */
  id: string
  /** Event name (one of EVENTS). */
  name: string
  /** Tenant scope, or null for tenant-agnostic events. */
  tenantId: string | null
  payload: T
  /** ISO timestamp the coordinator stamped at publish. */
  publishedAt: string
}

/** Handler for a subscribed event. */
export type EventHandler = (envelope: EventEnvelope) => void | Promise<void>

/** Transport primitives the coordinator delegates to a provider. */
export interface EventBusProvider {
  readonly providerName: string
  publish(envelope: EventEnvelope): Promise<void>
  subscribe(eventName: string, handler: EventHandler): void
  ack(envelopeId: string): Promise<void>
}
