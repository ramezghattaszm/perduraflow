import { HttpStatus } from '@nestjs/common'
import { AppException, ERROR_CODES } from '../exceptions/app.exception'

/**
 * Enforce that the requesting user owns the resource. Throws 403 (never 404) on
 * mismatch — we do not leak the existence of other users' resources
 * (API-ARCHITECTURE.md §11).
 */
export function assertOwnership(requestingUserId: string, resourceOwnerId: string): void {
  if (requestingUserId !== resourceOwnerId) {
    throw new AppException(HttpStatus.FORBIDDEN, 'Access denied', ERROR_CODES.FORBIDDEN)
  }
}
