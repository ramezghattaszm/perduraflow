/**
 * Common types shared by the API and all clients. This package is the ONLY
 * surface the two share (UI-ARCHITECTURE.md §1) — clients never import from
 * apps/api. The API imports the request schemas here for validation; clients
 * import the inferred request types and the response types.
 */

export type UserRole = 'user' | 'admin'

/**
 * Generic, app-agnostic error codes. The API's AppException is constructed with
 * these; the client mirrors them in i18n `errors.json`. App-specific codes are
 * added per app — these are the template baseline.
 */
export const ERROR_CODES = {
  // generic HTTP-ish
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  // auth / otp
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  // tenant / user
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  // example reference module
  EXAMPLE_NOT_FOUND: 'EXAMPLE_NOT_FOUND',
  // storage
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** Error response body (returned by the API's exception filter). */
export interface ApiErrorBody {
  statusCode: number
  message: string
  code: ErrorCode
}

/** Success envelope the transform interceptor wraps every response in. */
export interface ApiEnvelope<T> {
  statusCode: number
  data: T
}

/** Cursor-paginated list response. */
export interface Paginated<T> {
  items: T[]
  nextCursor: string | null
}
