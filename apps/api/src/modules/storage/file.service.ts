import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { env } from '../../config/env'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { generateId } from '../../db/ulid'
import { FileRepository } from './file.repository'
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './interfaces/storage-provider.interface'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
}

export interface UploadedFile {
  buffer: Buffer
  mimetype: string
  size: number
}

/**
 * File metadata + delivery over the pluggable storage provider (§10). The
 * provider (local/s3) is injected; this service validates and records uploads.
 */
@Injectable()
export class FileService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly repo: FileRepository,
  ) {}

  /**
   * Validates (size + mime), stores via the provider, and records the file as
   * uploaded by `userId`.
   *
   * @throws AppException FILE_TOO_LARGE - exceeds the size limit
   * @throws AppException FILE_TYPE_NOT_ALLOWED - mime type not permitted
   */
  async upload(userId: string, upload: UploadedFile): Promise<{ id: string; url: string }> {
    if (upload.size > MAX_BYTES) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'File too large', ERROR_CODES.FILE_TOO_LARGE)
    }
    if (!ALLOWED_MIME.has(upload.mimetype)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'File type not allowed',
        ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
      )
    }
    const key = `uploads/${generateId()}${EXT[upload.mimetype] ?? ''}`
    const stored = await this.storage.upload(key, upload.buffer, upload.mimetype)
    const rec = await this.repo.create({
      key,
      provider: env.STORAGE_PROVIDER,
      mimeType: upload.mimetype,
      sizeBytes: upload.size,
      uploadedBy: userId,
    })
    return { id: rec.id, url: stored.url }
  }

  /**
   * Resolves a stored file's delivery URL (signed for remote providers).
   *
   * @throws AppException FILE_NOT_FOUND - no file with this id
   */
  async getUrl(id: string): Promise<{ id: string; url: string }> {
    const rec = await this.repo.findById(id)
    if (!rec) {
      throw new AppException(HttpStatus.NOT_FOUND, 'File not found', ERROR_CODES.FILE_NOT_FOUND)
    }
    return { id: rec.id, url: await this.storage.getUrl(rec.key) }
  }
}
