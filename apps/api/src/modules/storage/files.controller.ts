import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { FileService } from './file.service'

/** Authenticated `/files` routes — multipart upload + URL resolution. */
@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FileService) {}

  /**
   * `POST /files` — upload a single multipart file (`file` field), recorded as
   * uploaded by the caller.
   *
   * @throws AppException VALIDATION_ERROR - no file in the request
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@CurrentUser() user: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'No file provided', ERROR_CODES.VALIDATION_ERROR)
    }
    return this.files.upload(user.sub, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    })
  }

  /** `GET /files/:id` — resolve a file's URL (signed for S3). */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.files.getUrl(id)
  }
}
