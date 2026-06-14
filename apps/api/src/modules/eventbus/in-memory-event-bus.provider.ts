import { Injectable, Logger } from '@nestjs/common'
import type { EventBusProvider, EventEnvelope, EventHandler } from './event-bus.types'

/**
 * Local in-memory EventBus provider (SKIP-05). Synchronous fan-out to in-process
 * subscribers; no durability, ordering guarantees, or replay — those arrive with
 * the Kafka-protocol provider behind the same interface. Sufficient for the demo
 * (single deployable, deployment shape B) and for keeping dev/CI cloud-free.
 */
@Injectable()
export class InMemoryEventBusProvider implements EventBusProvider {
  readonly providerName = 'in-memory'
  private readonly logger = new Logger('EventBus')
  private readonly handlers = new Map<string, EventHandler[]>()

  async publish(envelope: EventEnvelope): Promise<void> {
    const subs = this.handlers.get(envelope.name) ?? []
    for (const handler of subs) {
      try {
        await handler(envelope)
      } catch (err) {
        this.logger.error(`handler for ${envelope.name} threw: ${String(err)}`)
      }
    }
  }

  subscribe(eventName: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventName) ?? []
    existing.push(handler)
    this.handlers.set(eventName, existing)
  }

  async ack(_envelopeId: string): Promise<void> {
    // No-op for the in-memory provider (synchronous delivery, nothing to ack).
  }
}
