import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'
import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from '@perduraflow/contracts'

/**
 * Global catch-all filter. AppException bodies already carry `{statusCode,
 * message, code}`; other HttpExceptions are mapped to a code by status; unknown
 * errors are logged and returned as a 500 UNKNOWN_ERROR (never leaked).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const r = exception.getResponse()
      const body: ApiErrorBody =
        typeof r === 'object' && r !== null && 'code' in r
          ? (r as ApiErrorBody)
          : {
              statusCode: status,
              message: typeof r === 'string' ? r : exception.message,
              code: mapStatusToCode(status),
            }
      res.status(status).json(body)
      return
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception))
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
      code: ERROR_CODES.UNKNOWN_ERROR,
    } satisfies ApiErrorBody)
  }
}

function mapStatusToCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHORIZED
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_ERROR
    default:
      return ERROR_CODES.UNKNOWN_ERROR
  }
}
