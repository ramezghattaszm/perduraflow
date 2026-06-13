import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Injectable } from '@nestjs/common'
import { env } from '../../../config/env'
import type {
  StorageProvider,
  StoredObject,
} from '../interfaces/storage-provider.interface'

/** Local-disk storage for development. Files are served statically under /uploads. */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  async upload(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const full = join(env.LOCAL_STORAGE_PATH, key)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, body)
    return { key, url: `${env.LOCAL_STORAGE_URL}/${key}` }
  }

  async getUrl(key: string): Promise<string> {
    return `${env.LOCAL_STORAGE_URL}/${key}`
  }

  async delete(key: string): Promise<void> {
    await rm(join(env.LOCAL_STORAGE_PATH, key), { force: true })
  }
}
