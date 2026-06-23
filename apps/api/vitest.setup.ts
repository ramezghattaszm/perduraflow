/**
 * Test env shim. Importing API service modules transitively loads `config/env.ts`, which validates
 * required env at import and `process.exit(1)` if absent — fatal under vitest. These dummy values let
 * those modules import in unit tests (the pg Pool is created lazily in a Nest factory, never on
 * import, and tests use fakes — so nothing connects). Real env (CI/local) still wins via `??=`.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/perduraflow_test'
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789-abcdefghij'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789-abcdefghij'
