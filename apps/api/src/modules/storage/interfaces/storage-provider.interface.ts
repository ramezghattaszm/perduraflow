/**
 * Pluggable storage provider (API-ARCHITECTURE.md §10). FileService is the only
 * export other modules use; the concrete provider is chosen by STORAGE_PROVIDER.
 */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER')

export interface StoredObject {
  key: string
  url: string
}

export interface StorageProvider {
  upload(key: string, body: Buffer, contentType: string): Promise<StoredObject>
  getUrl(key: string): Promise<string>
  delete(key: string): Promise<void>
}
