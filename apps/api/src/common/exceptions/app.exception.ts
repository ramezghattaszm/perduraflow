import { HttpException, type HttpStatus } from '@nestjs/common'
import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from '@perduraflow/contracts'

export { ERROR_CODES }
export type { ErrorCode }

/**
 * The single application exception. Always thrown with one of the shared
 * ERROR_CODES (from the contracts package) so the response body the client sees
 * carries a stable `code` that maps to i18n errors.json. Ownership failures use
 * FORBIDDEN (403), never 404 (API-ARCHITECTURE.md §11).
 */
export class AppException extends HttpException {
  readonly code: ErrorCode
  constructor(statusCode: HttpStatus, message: string, code: ErrorCode) {
    const body: ApiErrorBody = { statusCode, message, code }
    super(body, statusCode)
    this.code = code
  }
}
