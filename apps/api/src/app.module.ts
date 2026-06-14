import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerModule } from '@nestjs/throttler'
import { PoolModule } from './db/pool'
import { AuthModule } from './modules/auth/auth.module'
import { EmailModule } from './modules/email/email.module'
import { EventBusModule } from './modules/eventbus/eventbus.module'
import { NotifierModule } from './modules/notifier/notifier.module'
import { OrgModule } from './modules/org/org.module'
import { TenantModule } from './modules/tenant/tenant.module'

/**
 * Root module — PerduraFlow phase 0 (kernel spine + organizational model).
 *
 * PoolModule (one shared Pool) + EventBusModule (coordinator + local provider)
 * are global. The kernel modules — tenant, auth, org — each own a Postgres schema
 * with a scoped Drizzle instance and interact only through contracts/services
 * (api-spec §0). `EventEmitterModule` remains for intra-module side effects only;
 * cross-module events go through EventBus.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20, verboseMemoryLeak: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PoolModule,
    EventBusModule,
    EmailModule,
    NotifierModule,
    TenantModule,
    OrgModule,
    AuthModule,
  ],
})
export class AppModule {}
