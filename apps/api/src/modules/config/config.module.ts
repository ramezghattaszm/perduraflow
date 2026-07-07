import { Module } from '@nestjs/common'
import { CONFIG_READ, ConfigReadService } from './config-read.service'
import { ConfigController } from './config.controller'
import { configDbProvider } from './config.db'
import { ConfigRepository } from './config.repository'
import { ConfigService } from './config.service'
import { ReferenceSetRepository } from './reference-set.repository'
import { ReferenceSetService } from './reference-set.service'

/**
 * Config module — the hierarchical configuration framework (CONFIG-FRAMEWORK-DESIGN). Owns the
 * `config` Postgres schema (overrides + audit + reference-set overrides) + a scoped Drizzle instance,
 * and publishes `config.read` (CONFIG_READ) for cross-module consumers (e.g. scheduling's continuous-
 * throughput window). EXPORTS only the read interface (O1). Setting groups plug in via descriptors
 * ({@link CONFIG_GROUPS}); reference sets (the 2nd content kind, {@link REFERENCE_SETS}) ride the same
 * scope substrate — the `reference.read` contract + admin CRUD land in a later commit.
 */
@Module({
  controllers: [ConfigController],
  providers: [
    configDbProvider,
    ConfigRepository,
    ConfigService,
    ConfigReadService,
    { provide: CONFIG_READ, useExisting: ConfigReadService },
    ReferenceSetRepository,
    ReferenceSetService,
  ],
  exports: [CONFIG_READ],
})
export class ConfigModule {}
