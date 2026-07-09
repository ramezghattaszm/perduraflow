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
  RESOURCE_DOWNTIME_NOT_FOUND: 'RESOURCE_DOWNTIME_NOT_FOUND',
  // a downtime window with `to <= from` (zero/negative duration)
  INVALID_DOWNTIME_WINDOW: 'INVALID_DOWNTIME_WINDOW',
  // cross-module reference validation via org.read 1.1 (O4)
  INVALID_CALENDAR_REFERENCE: 'INVALID_CALENDAR_REFERENCE',
  // part customer/program refs validated via org.read 1.2 (O4, Master Data Layer 1)
  INVALID_CUSTOMER_REFERENCE: 'INVALID_CUSTOMER_REFERENCE',
  INVALID_PROGRAM_REFERENCE: 'INVALID_PROGRAM_REFERENCE',
  // intra-module reference validation (resource-group members, op targets)
  INVALID_RESOURCE_REFERENCE: 'INVALID_RESOURCE_REFERENCE',
  INVALID_RESOURCE_GROUP_REFERENCE: 'INVALID_RESOURCE_GROUP_REFERENCE',
  // config reference-set suppression gate (a tombstone rejected because the value is still referenced)
  REFERENCE_VALUE_IN_USE: 'REFERENCE_VALUE_IN_USE',
  // unique business-key conflicts within a tenant scope
  DUPLICATE_PART_NO: 'DUPLICATE_PART_NO',
  DUPLICATE_CERTIFICATION_CODE: 'DUPLICATE_CERTIFICATION_CODE',
  // Layer 0 revise (Pattern A): a revision `effectiveFrom` not strictly after the current open version's.
  INVALID_REVISION_EFFECTIVE_FROM: 'INVALID_REVISION_EFFECTIVE_FROM',
  // Layer 2 BOM (Pattern A + draft/publish): no open draft to publish for a parent.
  BOM_NOT_FOUND: 'BOM_NOT_FOUND',
  // Layer 2 BOM integrity gate (D-L2-6): the BOM failed validation (missing component / cycle / effectivity / make-buy) — cannot publish.
  INVALID_BOM: 'INVALID_BOM',
  // Layer 2 tooling asset (Pattern B): no such tooling asset in the tenant.
  TOOLING_ASSET_NOT_FOUND: 'TOOLING_ASSET_NOT_FOUND',
  // Layer 2b (D-L2-7): a tooling_asset.asset_type write did not resolve to a registered member of the
  // tenant's `asset_type` reference set (reference.read, O7). The typed write-time rejection.
  INVALID_ASSET_TYPE: 'INVALID_ASSET_TYPE',
  // scheduling module (phase 2, api-spec §11.6)
  SCHEDULE_VERSION_NOT_FOUND: 'SCHEDULE_VERSION_NOT_FOUND',
  // Only a draft may be discarded — committed/superseded are immutable (IATF/audit). The boundary.
  SCHEDULE_VERSION_NOT_DRAFT: 'SCHEDULE_VERSION_NOT_DRAFT',
  OPTIMIZER_RUN_FAILED: 'OPTIMIZER_RUN_FAILED',
  SCHEDULE_INFEASIBLE: 'SCHEDULE_INFEASIBLE',
  NO_DEMAND_TO_SCHEDULE: 'NO_DEMAND_TO_SCHEDULE',
  // learning + closed loop (phase 3, api-spec §12.11)
  SCHEDULE_VERSION_NOT_COMMITTED: 'SCHEDULE_VERSION_NOT_COMMITTED',
  LEARNED_VALUE_REJECTED: 'LEARNED_VALUE_REJECTED',
  // parameter prediction + autonomy config (phase 4, api-spec §13.8)
  PREDICTION_NOT_FOUND: 'PREDICTION_NOT_FOUND',
  PREDICTION_NOT_QUEUED: 'PREDICTION_NOT_QUEUED',
  PREDICTION_NOT_ADOPTED: 'PREDICTION_NOT_ADOPTED',
  PREDICTION_NOT_SET_ASIDE: 'PREDICTION_NOT_SET_ASIDE',
  TIER3_REQUIRES_HUMAN: 'TIER3_REQUIRES_HUMAN',
  AUTONOMY_CONFIG_INVALID: 'AUTONOMY_CONFIG_INVALID',
  // what-if / baseline / narration (phase 5, api-spec §14.8)
  CHANGE_SET_INVALID: 'CHANGE_SET_INVALID',
  WHATIF_INFEASIBLE: 'WHATIF_INFEASIBLE',
  WHATIF_RESULT_NOT_FOUND: 'WHATIF_RESULT_NOT_FOUND',
  WHATIF_OPTION_NOT_FOUND: 'WHATIF_OPTION_NOT_FOUND',
  NARRATION_UNAVAILABLE: 'NARRATION_UNAVAILABLE',
  // operator assignment (C5 — planner assign/switch lever)
  OPERATOR_ASSIGNMENT_INVALID: 'OPERATOR_ASSIGNMENT_INVALID',
  OPERATOR_DOUBLE_BOOKED: 'OPERATOR_DOUBLE_BOOKED',
  OPERATOR_ASSIGNMENT_NOT_FOUND: 'OPERATOR_ASSIGNMENT_NOT_FOUND',
  // conversation (phase 6, api-spec §15.8)
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  CONVERSATION_TURN_FAILED: 'CONVERSATION_TURN_FAILED',
  // actuals ingestion grain (§4.3) — a grain on the actuals event the subscriber can't yet handle
  ACTUALS_GRAIN_UNSUPPORTED: 'ACTUALS_GRAIN_UNSUPPORTED',
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
