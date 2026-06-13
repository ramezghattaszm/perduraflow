import { type DynamicModule, Module } from '@nestjs/common'
import { env } from '../../config/env'
import { FileRepository } from './file.repository'
import { FileService } from './file.service'
import { FilesController } from './files.controller'
import { STORAGE_PROVIDER } from './interfaces/storage-provider.interface'
import { LocalStorageProvider } from './providers/local-storage.provider'
import { S3StorageProvider } from './providers/s3-storage.provider'

@Module({})
export class StorageModule {
  static register(): DynamicModule {
    const provider = env.STORAGE_PROVIDER === 's3' ? S3StorageProvider : LocalStorageProvider
    return {
      module: StorageModule,
      controllers: [FilesController],
      providers: [{ provide: STORAGE_PROVIDER, useClass: provider }, FileService, FileRepository],
      exports: [FileService],
    }
  }
}
