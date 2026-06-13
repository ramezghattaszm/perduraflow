import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE, type Database } from '../../db/drizzle.module'
import { file, type FileRecord } from '../../db/schema'

@Injectable()
export class FileRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(data: {
    key: string
    provider: 'local' | 's3'
    mimeType: string
    sizeBytes: number
    uploadedBy: string
  }): Promise<FileRecord> {
    const [created] = await this.db.insert(file).values(data).returning()
    return created!
  }

  findById(id: string): Promise<FileRecord | undefined> {
    return this.db.query.file.findFirst({ where: eq(file.id, id) })
  }
}
