import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerModule } from '@nestjs/throttler'
import { DrizzleModule } from './db/drizzle.module'
import { TenantModule } from './tenant/tenant.module'
import { AdminModule } from './modules/admin/admin.module'
import { AuthModule } from './modules/auth/auth.module'
import { EmailModule } from './modules/email/email.module'
import { ExampleModule } from './modules/example/example.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { NotifierModule } from './modules/notifier/notifier.module'
import { StorageModule } from './modules/storage/storage.module'
import { UsersModule } from './modules/users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DrizzleModule,
    TenantModule,
    EmailModule,
    NotifierModule,
    AuthModule,
    UsersModule,
    ExampleModule,
    NotificationsModule,
    AdminModule,
    StorageModule.register(),
  ],
})
export class AppModule {}
