import { Inject, Injectable, Logger } from '@nestjs/common'
import { generateId } from '../../db/ulid'
import { EVENT_BUS_PROVIDER, type EventBusProvider, type EventHandler } from './event-bus.types'

/**
 * EventBus coordinator (A4 / api-spec §5). The single seam for cross-module
 * events: it owns the envelope (ULID id + timestamp), publish audit, and the
 * event-name surface, delegating transport to the bound provider. Modules call
 * this — never raw EventEmitter2 across a boundary (O5).
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger('EventBus')

  constructor(@Inject(EVENT_BUS_PROVIDER) private readonly provider: EventBusProvider) {}

  /**
   * Wraps `payload` in an envelope and publishes it through the bound provider.
   * Records a one-line publish audit (SKIP-22 = minimal audit for the demo).
   */
  async publish<T>(name: string, payload: T, tenantId: string | null = null): Promise<void> {
    const envelope = { id: generateId(), name, tenantId, payload, publishedAt: new Date().toISOString() }
    this.logger.log(`publish ${name} (${envelope.id}) tenant=${tenantId ?? '-'} via ${this.provider.providerName}`)
    await this.provider.publish(envelope)
  }

  /** Subscribes a handler to an event name through the bound provider. */
  subscribe(eventName: string, handler: EventHandler): void {
    this.provider.subscribe(eventName, handler)
  }
}
