import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE, type Database } from '../../db/drizzle.module'
import { platformConfig, type PlatformConfig } from '../../db/schema'

@Injectable()
export class AdminRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listConfig(): Promise<PlatformConfig[]> {
    return this.db.select().from(platformConfig)
  }

  async upsertConfig(key: string, value: string, description: string | null): Promise<PlatformConfig> {
    const [row] = await this.db
      .insert(platformConfig)
      .values({ key, value, description })
      .onConflictDoUpdate({
        target: platformConfig.key,
        set: { value, description, updatedAt: new Date() },
      })
      .returning()
    return row!
  }
}
