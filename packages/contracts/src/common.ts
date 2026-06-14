/**
 * Common types shared by the API and all clients. This package is the ONLY
 * surface the two share (UI-ARCHITECTURE.md §1) — clients never import from
 * apps/api. The API imports the request schemas here for validation; clients
 * import the inferred request types and the response types.
 *
 * It is also the home of the **inter-module contracts** (api-spec §0/§4): each
 * inter-module contract carries an `id + version` from day one (SKIP-21), e.g.
 * the kernel `org.read` contract in `./org`.
 */

/**
 * App error codes. The API's AppException is constructed with these; the client
 * mirrors them in i18n `errors.json`. Generic codes are the template baseline;
 * the `org`/RBAC codes are PerduraFlow phase-0 additions (api-spec §6).
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
  // tenant / user / rbac
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  APPROVAL_TIER_NOT_FOUND: 'APPROVAL_TIER_NOT_FOUND',
  // org module (kernel organizational model)
  PLANT_NOT_FOUND: 'PLANT_NOT_FOUND',
  PLANT_GROUP_NOT_FOUND: 'PLANT_GROUP_NOT_FOUND',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  PROGRAM_NOT_FOUND: 'PROGRAM_NOT_FOUND',
  CALENDAR_NOT_FOUND: 'CALENDAR_NOT_FOUND',
  // cross-module reference validation (O4): a role's scoped plant/group id did
  // not resolve through the org.read contract.
  INVALID_PLANT_REFERENCE: 'INVALID_PLANT_REFERENCE',
  // unique-name conflict within a tenant scope
  DUPLICATE_NAME: 'DUPLICATE_NAME',
  // master-data module (phase 1, api-spec §10.4)
  PART_NOT_FOUND: 'PART_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_GROUP_NOT_FOUND: 'RESOURCE_GROUP_NOT_FOUND',
  ROUTING_NOT_FOUND: 'ROUTING_NOT_FOUND',
  ROUTING_OPERATION_NOT_FOUND: 'ROUTING_OPERATION_NOT_FOUND',
  CERTIFICATION_NOT_FOUND: 'CERTIFICATION_NOT_FOUND',
  OPERATOR_NOT_FOUND: 'OPERATOR_NOT_FOUND',
  // cross-module reference validation via org.read 1.1 (O4)
  INVALID_CALENDAR_REFERENCE: 'INVALID_CALENDAR_REFERENCE',
  // intra-module reference validation (resource-group members, op targets)
  INVALID_RESOURCE_REFERENCE: 'INVALID_RESOURCE_REFERENCE',
  INVALID_RESOURCE_GROUP_REFERENCE: 'INVALID_RESOURCE_GROUP_REFERENCE',
  // unique business-key conflicts within a tenant scope
  DUPLICATE_PART_NO: 'DUPLICATE_PART_NO',
  DUPLICATE_CERTIFICATION_CODE: 'DUPLICATE_CERTIFICATION_CODE',
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
