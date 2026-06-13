import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodSchema } from 'zod'
import { AppException, ERROR_CODES } from '../exceptions/app.exception'

/**
 * Validates a request body/query against a Zod schema (from the contracts
 * package). On failure throws a 400 VALIDATION_ERROR; on success returns the
 * parsed, typed value.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join(', ')
      throw new AppException(HttpStatus.BAD_REQUEST, message, ERROR_CODES.VALIDATION_ERROR)
    }
    return result.data
  }
}
