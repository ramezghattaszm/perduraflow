import { Global, Module } from '@nestjs/common'
import { EventBus } from './event-bus'
import { EVENT_BUS_PROVIDER } from './event-bus.types'
import { InMemoryEventBusProvider } from './in-memory-event-bus.provider'

/**
 * EventBus coordinator + local in-memory provider (SKIP-05). @Global so any
 * module injects `EventBus` without re-importing. Swapping to a Kafka-protocol
 * provider is changing the `EVENT_BUS_PROVIDER` binding here — nothing else.
 */
@Global()
@Module({
  providers: [
    InMemoryEventBusProvider,
    { provide: EVENT_BUS_PROVIDER, useExisting: InMemoryEventBusProvider },
    EventBus,
  ],
  exports: [EventBus],
})
export class EventBusModule {}
