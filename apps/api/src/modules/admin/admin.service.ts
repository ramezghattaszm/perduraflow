import { Injectable } from '@nestjs/common'
import type { PlatformConfig } from '../../db/schema'
import { AdminRepository } from './admin.repository'

export interface ConfigEntry {
  key: string
  value: string
  description: string | null
}

function toEntry(c: PlatformConfig): ConfigEntry {
  return { key: c.key, value: c.value, description: c.description }
}

/** Admin management of platform_config (runtime key-value config / feature flags). */
@Injectable()
export class AdminService {
  constructor(private readonly repo: AdminRepository) {}

  /** Returns all platform config entries. */
  async listConfig(): Promise<ConfigEntry[]> {
    return (await this.repo.listConfig()).map(toEntry)
  }

  /** Creates or updates a platform config entry by key. */
  async setConfig(key: string, value: string, description?: string): Promise<ConfigEntry> {
    return toEntry(await this.repo.upsertConfig(key, value, description ?? null))
  }
}
