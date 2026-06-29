# API Architecture Decisions & Patterns

> **Purpose:** Reusable architectural decisions for the API tier of any app built on this template.
> **Stack:** NestJS + Drizzle ORM + PostgreSQL + Socket.io + JWT
> **Runtime:** Node (the monorepo is managed by bun; the API *process* runs on Node).
> **Status:** Template baseline — generic. App-specific decisions go in `api-spec.md`, not here.

> **Editing rule:** This is a durable, reusable document. Do not add app-specific
> tables, modules, routes, or error codes here — those belong in the app's own
> `api-spec.md`. Only change this file to improve a pattern that applies to *every* app.

---

## 1. Project Structure

```
apps/api/
  src/
    main.ts                    ← bootstrap, CORS, middleware, global pipes/filters/interceptors
    app.module.ts              ← root module, imports all global modules
    config/
      env.validation.ts        ← Zod env schema, validated at startup (fail fast)
    db/
      drizzle.module.ts        ← Pool + drizzle() factory, DRIZZLE token (@Global)
      ulid.ts                  ← generateId() — application-layer ID generation
      seed.ts                  ← seeding script
      schema/
        index.ts               ← barrel re-export of all schemas
        *.schema.ts            ← one file per entity
    modules/
      example/                 ← ONE reference module showing the full pattern (delete or copy per app)
      email/                   ← infrastructure-only (provider-agnostic SMTP)
      notification/            ← domain-level, wraps email + future channels
    common/
      decorators/              ← @CurrentUser, @Roles, @SkipTransform
      exceptions/              ← AppException
      filters/                 ← exception → response shaping
      guards/                  ← JwtAuthGuard, RolesGuard
      interceptors/            ← TransformInterceptor (response envelope)
      pipes/                   ← ZodValidationPipe
      types/                   ← JwtPayload, shared types
      utils/                   ← assertOwnership, etc.
    events/                    ← internal event name constants
```

The **`example` module** is the canonical reference: it has a controller, service,
repository, DTOs, and types, and demonstrates the repository pattern, ownership
checks, DTO mapping, and event emission. Every new domain module is a copy of it.

---

## 2. Database (Drizzle + PostgreSQL)

### Provider Pattern

Single `pg` connection pool created once, shared across all repositories:

```ts
// db/drizzle.module.ts
export const DRIZZLE = Symbol('DRIZZLE')

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (config: ConfigService): Database => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        })
        return drizzle(pool, { schema })  // full schema barrel for relational queries
      },
      inject: [ConfigService],
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}

export type Database = ReturnType<typeof drizzle<typeof schema>>
```

- `@Global()` — register once in `AppModule`, available everywhere without re-importing
- `DRIZZLE = Symbol('DRIZZLE')` — consistent injection token across all repositories
- Full schema barrel passed to `drizzle()` — enables `db.query.xxx` relational queries

### Repository Pattern

One repository per module. Each repository owns only its module's tables:

```ts
@Injectable()
export class ExampleRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findAllActive(): Promise<Example[]> {
    return this.db.query.example.findMany({
      where: eq(example.isActive, true),
      orderBy: asc(example.sortOrder),
    })
  }

  async findById(id: string): Promise<Example | undefined> {
    const [row] = await this.db.select().from(example).where(eq(example.id, id)).limit(1)
    return row
  }

  async create(data: NewExample): Promise<Example> {
    const [row] = await this.db
      .insert(example)
      .values({ ...data, id: generateId() })   // app-layer ULID — never DB-generated
      .returning()
    return row
  }
}
```

### Schema Conventions

- One file per entity in `db/schema/`
- Every table has `createdAt` with `defaultNow()`
- Foreign keys use `.references(() => table.id)` with lazy arrow to avoid circular imports
- Enums as `text('col', { enum: ['a', 'b'] })` with exported `as const` arrays
- Export `Type = typeof table.$inferSelect` and `NewType = typeof table.$inferInsert`

### Schema Rules (enforce on every table — non-negotiable)

1. **Primary keys are always `text` storing ULIDs** — never `serial` or `integer`
2. **Foreign keys are always `text`** — must match the referenced table's `text` primary key
3. **ULIDs are generated in the application layer** — never by PostgreSQL. Use `generateId()`
   from `db/ulid.ts` in every repository `create()` method
4. **Never mix `serial`/`integer` IDs with `text` IDs** — one ID strategy across the whole schema
5. **Every table has `createdAt`** with `defaultNow()`
6. **Every tenant-scoped table carries a tenant/scope key** (see §4 Tenant Scoping) and is
   indexed on it
7. **Soft delete only** — never hard-delete user-facing data; use `isActive = false`
   (or a status transition for stateful entities)
8. **Migrations are never edited after creation** — generate a new migration for any change
9. **Custom SQL** (e.g. `tsvector`) goes in `drizzle/migrations/custom/` and runs separately
   via `db:migrate:custom`

```ts
// db/ulid.ts
import { ulid } from 'ulid'
export const generateId = () => ulid()
```

### Soft Delete Convention

- Never hard-delete user-facing data
- Use `isActive = false` for soft delete; use a status transition for stateful entities (orders, jobs)
- Hard delete only at repository level, never exposed via service or controller

### Full-Text Search (when needed)

PostgreSQL `tsvector`, generated column managed via a raw SQL migration (Drizzle does not
support generated columns on custom types). Keep custom SQL migrations separate and run them
after Drizzle migrations. (Pattern only — not in the baseline stub.)

---

## 3. Module Architecture (Modular Monolith)

### Microservice-Ready Boundaries

The API is a single deployable unit but structured for future service extraction.

**Rules — never violate:**

1. **No cross-module repository imports** — module A never imports module B's repository.
   Call module B's exported Service instead.
2. **No cross-module DB joins** — never join tables owned by different modules.
   Make two queries and merge in application code.
3. **Cross-module side effects use events** — `EventEmitter2` for all side effects across
   module boundaries. Never make direct service calls for side effects.
4. **Each module owns its tables** — only the owning module writes to its tables.
5. **Event names as constants** — define all event names in `src/events/index.ts`,
   never inline strings.

> Each app records its own module→table ownership map in `api-spec.md`. The map does not
> live here, but the *rules* above always apply.

### Module Internal Structure

```
modules/[name]/
  [name].module.ts
  [name].controller.ts
  [name].service.ts
  [name].repository.ts    ← all Drizzle queries for this module
  [name].events.ts        ← EventEmitter2 listeners
  dto/
    create-[name].dto.ts
    update-[name].dto.ts
  types/
    [name].types.ts
```

### Read vs Write Separation

- **Read** (GET) → public controller
- **Write** (POST/PATCH/DELETE) for reference/admin data → admin controller (see §9)
- Admin controllers delegate to the owning service, never to a repository directly

---

## 4. Auth & Security

### JWT Strategy

- Access token: **15 minutes**, signed with `JWT_SECRET`
- Refresh token: **90 days** (template default — set per app in `api-spec.md`), signed with `JWT_REFRESH_SECRET`
- Never reuse the same secret for both tokens

### Token Delivery

- **Access token** → response body, stored in memory on client
- **Refresh token** → httpOnly cookie for web, response body for native mobile

```ts
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 90 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth/refresh',  // scoped — only sent to refresh endpoint
}
```

### Platform Detection for Refresh

```ts
const token =
  req.cookies?.[REFRESH_COOKIE] ??  // web: httpOnly cookie
  body?.refreshToken                 // native: request body

const isWebClient = !!req.cookies?.[REFRESH_COOKIE]
return isWebClient ? { accessToken } : { accessToken, refreshToken }
```

### CORS Configuration

```ts
app.enableCors({
  origin: (origin, callback) => {
    const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:3001')
      .split(',').map(o => o.trim())
    if (!origin || allowed.includes(origin)) callback(null, true)
    else callback(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,  // required for httpOnly cookies
})
```

**Never use `origin: '*'` with `credentials: true`** — browsers reject this combination.

### Tenant / Scope Scoping (first-class rule)

Any app that serves more than one tenant, org, or isolation boundary must scope every
user-facing query by that boundary. The scope key is embedded in the JWT payload at login
and applied in every query — never inferred from a client-supplied parameter.

```ts
// In JwtStrategy — scope key resolved server-side at login, carried in the token
async validate(payload: JwtPayload) {
  // payload.tenantId (or orgId / scopeId) is authoritative
  return payload
}

// In every scoped query
.where(eq(resource.tenantId, user.tenantId))
```

- The scope key name (`tenantId`, `orgId`, `exchangeId`, …) is an app decision recorded in `api-spec.md`.
- The **rule** — scope on the server, from the token, on every user-facing query — is universal.
- Single-tenant apps may no-op this, but the column and the filter should still exist so the
  app can become multi-tenant without a rewrite.

### OTP Security (when the app uses OTP)

- Codes hashed with `bcrypt` (rounds=12) before storage
- Configurable expiry (default 10 minutes), single-use (`usedAt` on verify)
- Rate-limited (default max 1 resend / 60s per target)
- On resend: invalidate all previous unused OTPs for that target

---

## 5. Error Handling

### Exception Pattern

All exceptions use `AppException` with a machine-readable `code`:

```ts
throw new AppException(HttpStatus.NOT_FOUND, 'Resource not found', ERROR_CODES.NOT_FOUND)
```

### Error Response Shape

```json
{ "statusCode": 404, "message": "Resource not found", "code": "NOT_FOUND" }
```

### TransformInterceptor + SkipTransform

All responses are wrapped in `{ statusCode, data }` by `TransformInterceptor`.
Auth endpoints skip the wrapper via `@SkipTransform()`.

### Zod Validation Pipe

All DTOs validated with Zod via `ZodValidationPipe`; validation errors throw `AppException`
with the actual Zod messages and `ERROR_CODES.VALIDATION_ERROR`.

### Standard Error Codes (template baseline)

The template ships only the universal codes. Apps add their domain codes in `api-spec.md`.

```ts
// common/exceptions/error-codes.ts
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED:     'UNAUTHORIZED',
  FORBIDDEN:        'FORBIDDEN',
  NOT_FOUND:        'NOT_FOUND',
  UNKNOWN_ERROR:    'UNKNOWN_ERROR',
} as const
```

---

## 6. Email & Notification Architecture

### Separation of Concerns

```
EmailService (infrastructure)
  sendEmail(options): Promise<void>
  — only knows SMTP, attachments, headers; nothing about the domain
  — provider-agnostic: change SMTP env vars to switch providers

NotificationService (domain)
  sendXxxEmail(...): Promise<void>
  — knows business context, delegates delivery to EmailService
  — future: add SMS, push, in-app from here
```

Both `EmailModule` and `NotificationModule` are `@Global()` — import once in `AppModule`,
inject `NotificationService` anywhere. Specific notification methods are app-defined.

---

## 7. WebSocket Gateway (when the app needs real-time)

### Setup + Auth on Connect

Verify JWT on connection, attach the user to the socket, disconnect if invalid; join a
personal room for user-targeted events.

```ts
async handleConnection(client: AuthenticatedSocket) {
  try {
    const payload = this.jwtService.verify<JwtPayload>(client.handshake.auth['token'])
    client.user = payload
    client.join(`user:${payload.sub}`)
  } catch {
    client.disconnect(true)
  }
}
```

### Authorization on Room Join

Verify the user is a participant before joining a resource room; emit to rooms, never broadcast
user data globally. (Pattern only — not wired in the baseline stub.)

---

## 8. API Conventions

- **Global prefix:** `app.setGlobalPrefix('api/v1')`
- **Guards:** `JwtAuthGuard` on protected routes; `RolesGuard` for admin routes; apply at
  controller class level, not per method
- **Decorators:** `@CurrentUser() user: JwtPayload`, `@SkipTransform()`, `@Roles('admin')`
- **Pagination:** cursor-based for user-facing feeds; offset-based for admin tables;
  cursor = last item's `id` or `createdAt`
- **Response shape:** `{ statusCode, data }` via `TransformInterceptor`; raw for `@SkipTransform()`
- **Middleware order (main.ts):**

```ts
app.use(cookieParser())
app.use(helmet())
app.useGlobalPipes(...)        // validation
app.useGlobalFilters(...)      // exception formatting
app.useGlobalInterceptors(...) // response transform
app.enableCors(...)
```

---

## 9. Admin Module Pattern

- `AdminController` owns admin routes (`/admin/...`)
- It injects and delegates to the domain `Service`, never to repositories
- The domain `Service` exposes separate methods for admin vs public
  (`findAll()` unfiltered for admin; `findAllActive()` filtered for public)

Keeps business logic in the domain service while routing stays separate.

---

## 10. Pluggable Provider Pattern

Use for any infrastructure concern with multiple implementations (storage, email, SMS,
payments, push, search, cache). **This is the same coordinator-plus-provider idea used at the
platform level — keep it consistent.**

> **Provider pattern (infra) vs. config framework (policy) — the two halves of "nothing hardcoded".**
> The provider pattern swaps *infrastructure* (which implementation runs), selected by env var. Its
> sibling is the **configuration framework** for *policy/preference* values (which are not physics):
> tenant → plant → (line/resource where coherent) settings that cascade, reset, version, and audit.
> Anything swappable behind a contract that *also* has tunable parameters has **both** — a provider half
> (the binding) and a config half (a setting group). The optimizing engine is the canonical example:
> `external_solver` binding (provider) + Solver Policy (config). See `docs/CONFIG-FRAMEWORK-DESIGN.md`.

### Rules

1. Define a `Provider` interface with the minimum contract
2. Create concrete implementations (S3, Local, Twilio, Stripe, …)
3. A `Service` is the single public API — injects the active provider via injection token
4. `Module.register()` as a `DynamicModule` selects the active provider from config
5. Mark module `@Global()` — register once, inject the Service anywhere
6. Only the Service is exported — never the provider directly
7. Switching providers = changing one env var, zero code changes

### DynamicModule + Interface

```ts
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER')

export interface StorageProvider {
  readonly providerName: string
  upload(buffer: Buffer, key: string, mimeType: string): Promise<UploadResult>
  delete(key: string): Promise<void>
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<SignedUrlResult>
}

@Global()
@Module({})
export class StorageModule {
  static register(): DynamicModule {
    return {
      module: StorageModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: STORAGE_PROVIDER,
          useFactory: (config: ConfigService): StorageProvider => {
            return config.get('STORAGE_PROVIDER', 'local') === 's3'
              ? new S3StorageProvider(config)
              : new LocalStorageProvider(config)
          },
          inject: [ConfigService],
        },
        FileRepository,
        FileService,
      ],
      exports: [FileService],  // ← only the Service, never the provider
    }
  }
}
```

### When to Use

| Concern | Env Var | Providers |
|---|---|---|
| File storage | `STORAGE_PROVIDER` | `s3`, `local` |
| Email | `SMTP_*` | Any SMTP provider |
| SMS | `SMS_PROVIDER` | `twilio`, `stub` |
| Push | `PUSH_PROVIDER` | `fcm`, `apns`, `stub` |
| Payments | `PAYMENT_PROVIDER` | `stripe`, `stub` |
| Search | `SEARCH_PROVIDER` | `postgres`, `opensearch` |
| Cache | `CACHE_PROVIDER` | `memory`, `redis` |

---

## 11. Security Rules (never violate)

1. **Users can only access their own private data** — never another user's private resources
2. **Return 403 not 404** when a user accesses another user's resource — 404 leaks existence
3. **Public endpoints return PublicDto only** — never the full entity with sensitive fields
4. **All ownership checks use `assertOwnership()`** — never inline comparisons
5. **Admin routes require both `JwtAuthGuard` AND `RolesGuard`** — one guard is not enough
6. **`/me` routes derive the user id from the JWT only** — never from a query param or body
7. **Never expose** `passwordHash`, `refreshToken`, OTP codes, provider secrets, or internal
   join keys in any response, regardless of role

### Ownership Helper

```ts
// common/utils/ownership.ts
export function assertOwnership(requestingUserId: string, resourceOwnerId: string): void {
  if (requestingUserId !== resourceOwnerId) {
    throw new AppException(HttpStatus.FORBIDDEN, 'Access denied', ERROR_CODES.FORBIDDEN)
  }
}
```

### DTO Tiers

| DTO | Exposes | Used by |
|---|---|---|
| `EntityDto` | Full data for the owner | Owner (`/me` pattern) |
| `PublicEntityDto` | Safe subset | Any authenticated user |
| `AdminEntityDto` | Everything incl. internal fields | Admin only |

Never return a raw entity from a controller — always map to the DTO for the requester's role.

### 403 vs 404

- Does not exist → **404**
- Exists, requester not owner → **403**
- Exists, requester lacks role → **403**

---

## 12. Environment Variables

Validate with Zod at startup — fail fast if a required var is missing. The template ships
the universal vars; apps add their own in `api-spec.md`.

```ts
// src/config/env.validation.ts
const envSchema = z.object({
  DATABASE_URL:       z.string().url(),
  JWT_SECRET:         z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CORS_ORIGIN:        z.string().default('http://localhost:3001'),
  PORT:               z.coerce.number().default(3000),
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  // App-specific (SMTP_*, STORAGE_*, etc.) added per app.
})
```

---

## 13. Commands (bun-managed monorepo, Node-run API)

```bash
bun --filter @perduraflow/api dev            # start API (Node runtime)
bun --filter @perduraflow/api db:generate    # generate Drizzle migration
bun --filter @perduraflow/api db:migrate     # apply migrations
bun --filter @perduraflow/api db:migrate:custom  # apply custom SQL migrations
bun --filter @perduraflow/api db:seed        # seed
bun run db:setup                    # create the app database (root script)
```

> **Build footgun — do not enable `incremental` in `apps/api/tsconfig.json`.** `nest-cli`'s
> `deleteOutDir: true` wipes `dist/` on every build, but tsc's `incremental` writes
> `tsconfig.tsbuildinfo` *outside* `dist/` — so after a wipe tsc believes everything is already
> emitted and produces an **empty `dist/`**, and `node dist/main` fails with `MODULE_NOT_FOUND`.
> `incremental` is a no-op when the outDir is cleared each build anyway. If you hit an empty `dist`,
> `rm -f apps/api/tsconfig.tsbuildinfo && rm -rf apps/api/dist` and rebuild. Prefer `bun … api dev`
> (watch) in development.

---

## 14. Documentation (JSDoc)

Document **intent and contracts**, not types. TypeScript already carries the types; a JSDoc
comment that restates them (`@param userId The user id`) is noise that rots. Use the comment for
what the signature can't express: why this exists, the ownership/tenant contract, what it throws,
and its side effects.

### Where it's required
JSDoc on every **exported** surface: controllers, service methods, providers, guards, and shared
types. Internal private helpers don't need it.

### What to document
- **Service methods:** the ownership/tenant contract (who supplies `userId`/`tenantId`, whether
  ownership is verified) — the §11 ownership-contract rule, written on-site as JSDoc.
- **Throws:** every `AppException` code a caller should expect (`@throws`).
- **Side effects:** events emitted, external calls, state mutated.
- **Non-obvious behavior:** anything a reader would otherwise trace the body to learn.

### Don't
- Don't restate parameter or return types in prose.
- Don't document trivial getters/mappers whose name says everything.
- Don't let a comment drift — change it with the code or delete it.

```ts
/**
 * Updates the caller's own profile. Tenant-scoped.
 *
 * Ownership: `userId` is the caller's id from the JWT (`@CurrentUser`); a user can only
 * update their own profile. Cross-user updates are impossible by construction (no id param).
 *
 * @throws AppException NOT_FOUND  - no profile for this user in the caller's tenant
 * @throws AppException VALIDATION_ERROR - dto failed schema validation
 * Emits `user.updated` on success.
 */
async updateOwnProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfile> { … }
```

### Enforcement
`eslint-plugin-jsdoc`, scoped to **exported** declarations, wired into the typecheck/lint gate —
require the comment to exist and validate tag syntax, but do not require descriptions on every
`@param`. If a surface is public/consumed, prefer generating OpenAPI from the Nest decorators so
that contract is derived, not hand-maintained.

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| 1.0 | — | Generalized from the Mercor API architecture; de-branded; tenant-scoping promoted to a first-class rule; reduced to one `example` module; error codes trimmed to universal set; bun scripts. |
| 1.1 | 2026-06-14 | §13: documented the NestJS build footgun (`incremental` + `deleteOutDir` → empty `dist`/`MODULE_NOT_FOUND`). Note: the *contract-bound module* override of §3 is recorded per-app in `api-spec.md §0` (not here). |
