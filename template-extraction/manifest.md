# Template Extraction Manifest — Pass 1

> **Status:** Inventory only. No files have been modified. Awaiting approval before Pass 2.
> **Source:** `../mercor/mercor-v2/` (read-only)
> **Target placeholders:** `PerduraFlow`, `perduraflow`, `com.perduraflow.app`

---

## 1. IDENTIFIER MANIFEST

### 1.1 Workspace Scopes & Package Names

| Current identifier | Location(s) | Proposed generic form |
|---|---|---|
| `@mercor/api` | `apps/api/package.json` → `name`; root `package.json` scripts (`db:setup`, `db:generate`, etc.) | `@perduraflow/api` |
| `@my/ui` | `packages/ui/package.json` → `name`; `apps/expo/package.json` dep | `@perduraflow/ui` |
| `@my/config` | `packages/config/package.json` → `name`; all UI source imports | `@perduraflow/config` |
| `app` (bare) | `packages/app/package.json` → `name`; `apps/expo/package.json` dep | `@perduraflow/app` |
| `mercor` (root) | Root `package.json` → `name`; turbo.json exclusion `--exclude next-app` | `perduraflow` |
| `mercor-mobile` | `apps/expo/package.json` → `name` | `perduraflow-mobile` |
| `mercor-web` | `apps/next/package.json` → `name` | `perduraflow-web` |

### 1.2 App Identity

| Current value | Location(s) | Proposed generic form |
|---|---|---|
| `Mercor` (display name) | `apps/expo/app.json` → `expo.name`; `apps/next/app/layout.tsx` → metadata title `"Mercor — Campus Marketplace"` | `PerduraFlow` |
| `mercor` (slug) | `apps/expo/app.json` → `expo.slug`; `apps/expo/app.json` → `expo.scheme` | `perduraflow` |
| `com.mercor` | `apps/expo/app.json` → `expo.ios.bundleIdentifier`, `expo.android.package` | `com.perduraflow.app` |
| `mercor` (database name) | `apps/api/.env.example` → `DATABASE_URL` default `postgresql://...@localhost:5432/mercor`; `apps/api/drizzle.config.ts` → default fallback URL | `perduraflow` |
| `mercor_auth` (presence cookie) | `apps/next/middleware.ts:14`; `apps/next/src/lib/local-storage-token-store.ts:11`; `apps/next/app/providers.tsx:25–26` | `perduraflow_auth` |
| `mercor_refresh` (httpOnly cookie) | `apps/api/src/modules/auth/auth.controller.ts:25` → `const REFRESH_COOKIE = 'mercor_refresh'`; `apps/next/app/providers.tsx:26` (comment) | `perduraflow_refresh` |
| `mercor_refresh_token` (Secure Store key) | `packages/app/lib/refresh-store.native.ts:6` → `const KEY = 'mercor_refresh_token'` | `perduraflow_refresh_token` |
| `EXPO_PUBLIC_API_URL` / `NEXT_PUBLIC_API_URL` | `packages/app/lib/axios.ts` (env var lookup) | These are generic; keep as-is — no Mercor brand in name |
| `noreply@mercor.app` | `apps/api/src/modules/email/email.service.ts:39` → `configService.get('SMTP_FROM', 'noreply@mercor.app')` | `noreply@perduraflow.app` → **move entirely to env** (`SMTP_FROM` already exists); remove hardcoded fallback |
| `AWS_S3_BUCKET=mercor-uploads` | `apps/api/.env.example` | `perduraflow-uploads` (or fully env-driven — remove example value) |
| `"mercor"` provider name | `apps/expo/app/_layout.tsx` → `<Provider defaultTheme="mercor">`; `packages/config/src/tamagui.config.ts` → theme key `mercor` / `mercor_dark` | `perduraflow` / `perduraflow_dark` |
| `"mercor"` route scheme | `apps/expo/app.json` → `expo.scheme: "mercor"` | `perduraflow` |

### 1.3 Theme Tokens (brand/domain meaning)

All tokens are defined in `packages/config/src/tamagui.config.ts` with the `mercor` prefix. Every use in `packages/ui/src/**` and `apps/next/app/(main)/layout.tsx` references `$mercorXxx`.

| Current token | Used in | Proposed generic token |
|---|---|---|
| `$mercorPrimary` | MercorButton (primary/ghost/danger variants), MercorInput (focus border/outline), PriceTag color, ConversationRow unread count bg, layout sidebar active icon/text, cart badge bg | `$primary` |
| `mercorPrimaryLight` (dark palette only, no `$` usage in UI yet) | `mercorDarkColors` definition | `$primaryLight` |
| `$mercorSurface` | MercorButton (light/ghost/darkblue variants bg), MercorInput default bg, MercorAvatar fallback bg | `$surface` |
| `$mercorSurfaceGhost` | MercorInput ghost variant bg | `$surface` + opacity (or `$surfaceGhost`) |
| `$mercorBackground` | Root layout bg, MercorAvatar fallback, layout sidebar nav hover/active bg | `$background` |
| `$mercorTextPrimary` | MercorInput text + label, MercorSwitch label | `$textPrimary` |
| `$mercorTextSecondary` | MercorInput placeholder/hint, ConversationRow secondary text, layout sidebar inactive icon/text | `$textSecondary` |
| `$mercorDanger` | MercorButton danger variant bg, MercorInput error border/text | `$danger` |
| `$mercorDangerOnGradient` | Gradient screen error text (niche) | `$danger` (or `$dangerOnGradient` — see Open Questions) |
| `$mercorSuccess` | OrderStatusBanner completed state | `$success` |
| `$mercorGradientStart` | GradientScreen (native + web), fallback `'#C8E6FF'` hardcoded in `.web.tsx` | `$gradientStart` |
| `$mercorGradientEnd` | GradientScreen, fallback `'#4A6FE3'` hardcoded in `.web.tsx` | `$gradientEnd` |
| `$mercorHeaderBlue` | Expo SafeAreaView `backgroundColor` in route files (`#4E94F9` hardcoded — see §1.4) | `$headerPrimary` (or drop and reference `$primary` — see Open Questions) |
| `$mercorBottomBar` | `MercorTabBar.tsx` background | `$navBar` (or `$primary` — see Open Questions) |
| `$mercorDarkBlue` | Not found in UI components (defined but unused outside config) | Drop or map to `$navBar` |
| `$mercorDarkOverlay` | GradientScreen overlay; ListingCard sold/reserved overlay | `$overlay` |

**Token name object (light palette, `packages/config/src/tamagui.config.ts:6–23`):**
```
mercorPrimary:       '#2D5BE3'
[unnamed e]:         '#7EB3FF'        ← typo/orphan key, not referenced anywhere
mercorSurface:       '#FFFFFF'
mercorSurfaceGhost:  'rgba(255,255,255,0.18)'
mercorBackground:    '#F0F4FF'
mercorTextPrimary:   '#1A1A2E'
mercorTextSecondary: '#6B7280'
mercorSuccess:       '#22C55E'
mercorDanger:        '#EF4444'
mercorDangerOnGradient: '#FFB4B4'
mercorDarkOverlay:   'rgba(0,0,0,0.2)'
mercorGradientStart: '#C8E6FF'
mercorGradientEnd:   '#4A6FE3'
mercorDarkBlue:      'rgb(0,87,167)'
mercorHeaderBlue:    '#4E94F9'
mercorBottomBar:     'rgb(0,66,158)'
```

Note: light palette is **missing `mercorPrimaryLight`** — it only exists in `mercorDarkColors`. Also note the orphan key `e: '#7EB3FF'` (line 8) — likely a typo for `mercorPrimaryLight`.

### 1.4 Hardcoded Hex Colors (bypassing tokens)

These appear in route/layout files where `SafeAreaView` requires a native React style object (cannot use Tamagui tokens directly):

| Value | File(s) | Semantic meaning | Proposed fix |
|---|---|---|---|
| `'#4E94F9'` | `apps/expo/app/(tabs)/index.tsx:8`; `apps/expo/app/(tabs)/sell/index.tsx:7`; `apps/expo/app/(tabs)/cart/index.tsx:7`; `apps/expo/app/category/[id].tsx:9`; `apps/expo/app/listing/[id].tsx:9` | `$mercorHeaderBlue` — status bar matches header | Use `useTheme().mercorHeaderBlue.val` or a utility wrapper |
| `'#F0F4FF'` | `apps/expo/app/(tabs)/messages/index.tsx:7`; `apps/expo/app/(tabs)/profile/settings.tsx:6`; `apps/expo/app/_layout.tsx:65` | `$mercorBackground` | Same approach |
| `'#C8E6FF'` | `packages/ui/src/GradientScreen.web.tsx` | `$gradientStart` fallback | Read from theme prop |
| `'#4A6FE3'` | `packages/ui/src/GradientScreen.web.tsx` | `$gradientEnd` fallback | Read from theme prop |

### 1.5 Hardcoded Strings (domain-specific)

| Value | File | Type |
|---|---|---|
| `"noreply@mercor.app"` | `apps/api/src/modules/email/email.service.ts:39` | Email sender — remove hardcoded fallback; make `SMTP_FROM` fully required |
| `"Mercor — the campus marketplace."` | `apps/api/src/modules/notification/notification.service.ts:30–31` | Welcome email body copy |
| `"Buy and sell secondhand items with students on your campus."` | `apps/next/app/layout.tsx:11` | Next.js metadata description |
| `"campus marketplace"` | `packages/app/i18n/locales/en/auth.json:16` (login subtitle), `auth.json:34` (register subtitle) | i18n strings — replace with generic copy |
| `"Columbia University Network"`, `"Mercor Internal"`, `"Columbia University"`, `"Barnard College"`, `"Mercor Admin"`, `"admin@mercor.app"`, `"admin@columbia.edu"`, `"admin@barnard.edu"` | `apps/api/src/db/seed.ts:129–142` | Seed data — replace with generic placeholder tenant |

### 1.6 Component/Class Names (brand in name)

| Current name | File | Proposed generic name |
|---|---|---|
| `MercorException` | `apps/api/src/common/exceptions/mercor.exception.ts` | `AppException` |
| `ERROR_CODES` (contains `UNIVERSITY_NOT_FOUND`, `EXCHANGE_NOT_FOUND`, `EXCHANGE_HAS_UNIVERSITIES`, `UNIVERSITY_HAS_USERS`, `DOMAIN_ALREADY_EXISTS`) | same file | Keep generic codes; drop Mercor-domain codes from template |
| `MercorButton` | `packages/ui/src/MercorButton.tsx`; barrel export | `AppButton` |
| `MercorInput` | `packages/ui/src/input/MercorInput.tsx`; barrel export | `AppInput` |
| `MercorAvatar` | `packages/ui/src/Avatar.tsx`; barrel export | `AppAvatar` |
| `MercorSwitch` | `packages/ui/src/MercorSwitch.tsx`; barrel export | `AppSwitch` |
| `MercorToast` | `packages/ui/src/toast/MercorToast.tsx` | `AppToast` |
| `MercorToastViewport` | `packages/ui/src/toast/MercorToastViewport.tsx` | `AppToastViewport` |
| `MercorTabBar` | `apps/expo/src/components/MercorTabBar.tsx` | `AppTabBar` (expo-app-specific, not in packages/ui) |
| `ListingCard` | `packages/ui/src/ListingCard.tsx` | DROP-DOMAIN |
| `CategoryCard` | `packages/ui/src/CategoryCard.tsx` | DROP-DOMAIN |
| `PriceTag` | `packages/ui/src/PriceTag.tsx` | DROP-DOMAIN |
| `ConditionBadge` | `packages/ui/src/ConditionBadge.tsx` | DROP-DOMAIN |
| `ConversationRow` | `packages/ui/src/ConversationRow.tsx` | DROP-DOMAIN |
| `OrderStatusBanner` | `packages/ui/src/OrderStatusBanner.tsx` | DROP-DOMAIN |
| `mercor` / `mercor_dark` (Tamagui theme names) | `packages/config/src/tamagui.config.ts:59,63`; `apps/expo/app/_layout.tsx` | `perduraflow` / `perduraflow_dark` |
| `ZodValidationPipe` (references `MercorException`) | `apps/api/src/common/pipes/zod-validation.pipe.ts` | Keep name; update to use `AppException` |
| `assertOwnership` (references `MercorException`) | `apps/api/src/common/utils/ownership.ts` | Keep name; update to use `AppException` |

---

## 2. MODULE TRIAGE — `apps/api/src/modules/`

### KEEP-GENERIC

| Module | Verdict | Notes |
|---|---|---|
| `auth` | **KEEP-GENERIC** | Tenant entanglement documented in §2.1. JWT/OTP/refresh mechanics are fully reusable. |
| `users` | **KEEP-GENERIC** | `universityId` FK must be replaced with `tenantId` (see §2.1). `/me` endpoint is clean. |
| `email` | **KEEP-GENERIC** | Pluggable provider pattern. Only change: remove `noreply@mercor.app` fallback. |
| `notification` | **KEEP-GENERIC** | Welcome email copy references Mercor (§1.5). Otherwise generic. |
| `notifications` | **KEEP-GENERIC** | Generic in-app notification CRUD — no domain logic. |
| `storage` | **KEEP-GENERIC** | Pluggable `local`/`s3` providers. Zero domain coupling. |
| `admin` | **OPEN QUESTION** | Currently manages `exchange` + `university` + `platform_config`. If tenant entity is app-specific, this module's exchange/university CRUD is domain-specific. The `platform_config` CRUD is generic. See §2.2. |

### EXAMPLE MODULE

**Proposed: `categories` → genericized as `example`**

Rationale: simplest CRUD module in the codebase — one table, no cross-module joins, minimal business logic. Pattern: controller → service → repository (Drizzle) → event → DTO.

Files to port to `example`:
- `categories.controller.ts` → `example.controller.ts`
- `categories.service.ts` → `example.service.ts`
- `categories.repository.ts` → `example.repository.ts`
- `categories.module.ts` → `example.module.ts`
- `categories.events.ts` → `example.events.ts`
- `types/categories.types.ts` → `types/example.types.ts`
- `dto/create-category.dto.ts` → `dto/create-example.dto.ts`
- `dto/update-category.dto.ts` → `dto/update-example.dto.ts`
- Schema: `category.schema.ts` → `example.schema.ts`

The example module will demonstrate: ULID PKs, `isActive` soft delete, `assertOwnership` usage, `EventEmitter2` side effects, Zod-validated DTOs, public/admin DTO tiers.

### DROP-DOMAIN

| Module | Verdict | Notes |
|---|---|---|
| `listings` | **DROP-DOMAIN** | Marketplace listing CRUD, condition/status enum, `exchangeId` scoping, image management. |
| `cart` | **DROP-DOMAIN** | E-commerce cart. |
| `favorites` | **DROP-DOMAIN** | User-saves-listing. |
| `conversations` | **DROP-DOMAIN** | Listing-scoped messaging threads. |
| `messages` | **DROP-DOMAIN** | WebSocket real-time messaging; depends on conversations + listings. |
| `orders` | **DROP-DOMAIN** | P2P in-person transaction flow (meet → inspect → complete/cancel). |
| `categories` | **DROP-DOMAIN** (becomes EXAMPLE) | Domain-specific as-is; genericized version becomes the `example` module. |

### 2.1 AUTH Tenant Entanglement

The following Mercor-specific elements are entangled with the `user → university → exchange` model and must be replaced by a generic `tenantId` hook:

| Entanglement | Location | Template change |
|---|---|---|
| `universityId` FK on `user` table | `apps/api/src/db/schema/user.schema.ts:11` | Replace with `tenantId text` FK → generic `tenant` table |
| `universityId` in `JwtPayload` | `apps/api/src/common/types/jwt-payload.types.ts:8` | Replace with `tenantId: string` |
| `exchangeId` in `JwtPayload` | `apps/api/src/common/types/jwt-payload.types.ts:7` | Replace with nothing (or keep as second-level grouping — see Open Questions) |
| `auth.service.ts` → register: looks up `university` by domain, resolves `exchangeId`, embeds both in JWT | `apps/api/src/modules/auth/auth.service.ts` | Replace university-domain lookup with a generic `tenantId` resolver hook (app fills it in) |
| `auth.repository.ts` → `findUniversityByDomain` | `apps/api/src/modules/auth/auth.repository.ts` | Drop; replaced by app-specific tenant-resolution hook |
| `exchange` + `university` + `university_domain` FK on `user` | Schema | Replaced by `tenant` table (app-specific shape) |
| Admin module's exchange/university management | `apps/api/src/modules/admin/` | Domain-specific (see §2.2) |

**Mechanics that are clean and reusable as-is:**
- OTP generation/verification (`otp_code` table)
- JWT signing with access + refresh token pair (cookie on web, body on native)
- `bcrypt` password hashing
- Refresh token rotation
- Rate-limit guard on auth routes (`@nestjs/throttler`)
- `forgot-password` → OTP → `reset-password` flow

### 2.2 TABLES — Keep vs Flag

**KEEP (template core tables):**
| Table | Verdict | Notes |
|---|---|---|
| `user` | **KEEP** | Requires `universityId` → `tenantId` rename. `faceIdEnabled` is biometric flag — generic. |
| `otp_code` | **KEEP** | Generic OTP table used by both email and SMS channels. |
| `file` | **KEEP** | Storage metadata. Zero domain coupling. |
| `example` (from `category`) | **KEEP** | Genericized reference CRUD table for the example module. |

**FLAG FOR DECISION (tenant model — app-specific shape):**
| Table | Verdict | Notes |
|---|---|---|
| `exchange` | **FLAG** | Mercor's top-level tenant grouping. In a single-tenant app this collapses to one row. In a multi-tenant app the entity shape is app-specific. |
| `university` | **FLAG** | Mid-level tenant entity. App-specific. |
| `university_domain` | **FLAG** | Email-domain → university mapping. Entirely app-specific. |
| `platform_config` | **FLAG** | Key-value config table (generic concept) but currently managed by the domain-coupled `admin` module. Recommend keeping the table; the admin module that manages it is domain-specific. |

**DROP (domain tables):**
| Table | Verdict |
|---|---|
| `listing`, `listing_image` | DROP |
| `cart`, `cart_item` | DROP |
| `favorite` | DROP |
| `conversation`, `conversation_message` | DROP |
| `order` | DROP |
| `category` | Genericized → `example` |

---

## 3. COMPONENT TRIAGE — `packages/ui/src/`

Dependencies listed lowest-level first (porting order).

### KEEP-GENERIC

| Component | File | Deps | Notes |
|---|---|---|---|
| `H` | `typography/H.tsx` | `@perduraflow/config` (parseVariant, headingFont) | Pure typography. Zero domain coupling. |
| `P` | `typography/P.tsx` | `@perduraflow/config` (parseVariant, bodyFont) | Pure typography. |
| `AppToast` (← MercorToast) | `toast/MercorToast.tsx` | tamagui Toast, `@perduraflow/config` (toastConfig) | Generic; only branding is the name. |
| `AppToastViewport` (← MercorToastViewport) | `toast/MercorToastViewport.tsx` | tamagui ToastViewport | Generic 6-position viewport setup. |
| `AppButton` (← MercorButton) | `MercorButton.tsx` | tamagui, `$primary`/`$surface`/`$danger` tokens | Rename + token rename only. No domain logic. |
| `AppSwitch` (← MercorSwitch) | `MercorSwitch.tsx` | tamagui | Rename only. |
| `AppInput` (← MercorInput) | `input/MercorInput.tsx` | tamagui, `$primary`/`$surface`/`$danger`/`$textPrimary` | Rename + token rename. Important dep for auth screens. |
| `OtpInput` | `OtpInput.tsx` | tamagui | Generic OTP input. No branding in name or logic. |
| `AppAvatar` (← MercorAvatar) | `Avatar.tsx` | tamagui | Rename + token rename. |
| `EmptyState` | `EmptyState.tsx` | tamagui, `AppButton` | Generic. Depends on AppButton. |
| `GradientScreen` | `GradientScreen.tsx` / `GradientScreen.web.tsx` | expo-linear-gradient (native), tamagui, `$gradientStart`/`$gradientEnd` | Token rename. Remove hardcoded hex fallbacks (§1.4). |

### DROP-DOMAIN

| Component | File | Reason |
|---|---|---|
| `ListingCard` | `ListingCard.tsx` | Marketplace listing display. Deps: PriceTag, ConditionBadge, AppAvatar. |
| `CategoryCard` | `CategoryCard.tsx` | Category grid item. |
| `PriceTag` | `PriceTag.tsx` | Formats USD cents. Currency format is app-specific. |
| `ConditionBadge` | `ConditionBadge.tsx` | new/like_new/good/fair — listing-specific enum. |
| `ConversationRow` | `ConversationRow.tsx` | Messaging UI. |
| `OrderStatusBanner` | `OrderStatusBanner.tsx` | P2P order flow. |

**Note on `types.ts`:** `packages/ui/src/types.ts` exports `ListingCondition`, `ListingStatus`, `OrderStatus`, `Listing`, `ConversationParty`, `ConversationPreview`, `OrderWithRole`, `UserProfile`. All domain types — DROP except `UserProfile`, which is generic enough to keep (rename file to avoid confusion).

---

## 4. SCREEN TRIAGE — `packages/app/features/`

### KEEP-GENERIC (auth flow)

| Screen | File | Notes |
|---|---|---|
| `OnboardingScreen` | `auth/onboarding-screen.tsx` | 3-slide FlatList. Slide copy ("campus marketplace") lives in i18n and must be updated. Structure is generic. |
| `LoginScreen` | `auth/login-screen.tsx` | Email/password + biometric. Fully generic post token-rename. Contains `launchRoute`/locked-mode logic. |
| `RegisterScreen` | `auth/register-screen.tsx` | 4-field form. No domain fields. |
| `VerifyOtpScreen` | `auth/verify-otp-screen.tsx` | Generic OTP verification for registration and password reset. |
| `ForgotPasswordScreen` | `auth/forgot-password-screen.tsx` | Generic. |
| `ResetPasswordScreen` | `auth/reset-password-screen.tsx` | Generic. |

### DROP-DOMAIN

| Screen | File | Reason |
|---|---|---|
| `HomeScreen` | `home/home-screen.tsx` | Categories grid + search. Mercor marketplace UI. |
| `CategoryScreen` | `listings/category-screen.tsx` | Listing browse by category. |
| `ListingDetailScreen` | `listings/listing-detail-screen.tsx` | Listing detail, cart/message actions. |
| `SellScreen` | `sell/sell-screen.tsx` | Create listing flow. |
| `CartScreen` | `cart/cart-screen.tsx` | Shopping cart. |
| `MessagesScreen` | `messages/messages-screen.tsx` | Conversation list. |
| `ConversationScreen` | `messages/conversation-screen.tsx` | WebSocket real-time chat + order management. |
| `ProfileScreen` | `profile/profile-screen.tsx` | My Listings / Favorites nav. Partially generic (avatar card, logout) but tightly coupled to Mercor nav structure. **Open Question — see §OQ.** |
| `SettingsScreen` | `profile/settings-screen.tsx` | Currently only biometric toggle — no domain coupling. **Open Question — partially generic.** |

### Expo route files (all in `apps/expo/app/`)

| Route | Verdict | Notes |
|---|---|---|
| `_layout.tsx` | **KEEP** | Root layout: font loading, auth hydration, `<Provider defaultTheme="perduraflow">`, `<Stack>`. Replace theme name and tab bar component name. |
| `index.tsx` | **KEEP** | Launch redirect — generic. |
| `(auth)/_layout.tsx` | **KEEP** | Auth group layout — generic. |
| `(auth)/login.tsx` … `(auth)/reset-password.tsx` | **KEEP** | Thin re-export wrappers — generic. |
| `(tabs)/_layout.tsx` | **KEEP** | Stack wrapper — generic. |
| `(tabs)/index.tsx` (Home) | **DROP** | Hardcoded `#4E94F9` + HomeScreen. |
| `(tabs)/cart/index.tsx` | **DROP** | Domain. |
| `(tabs)/messages/` | **DROP** | Domain. |
| `(tabs)/sell/index.tsx` | **DROP** | Domain. |
| `(tabs)/profile/index.tsx` | **OPEN** | See §OQ. |
| `(tabs)/profile/settings.tsx` | **OPEN** | See §OQ. |
| `category/[id].tsx` | **DROP** | Domain. |
| `listing/[id].tsx` | **DROP** | Domain. |

### Next.js route files (`apps/next/app/`)

| Route | Verdict | Notes |
|---|---|---|
| `layout.tsx` | **KEEP** | Replace title/description with `PerduraFlow`. |
| `providers.tsx` | **KEEP** | Replace `mercor_auth` cookie name. |
| `middleware.ts` | **KEEP** | Replace `mercor_auth` cookie name. |
| `(auth)/` routes | **KEEP** | Thin wrappers — generic. |
| `(main)/layout.tsx` | **DROP** | Sidebar with Mercor-specific nav items (Home/Messages/Sell/Cart/Profile). |
| `(main)/page.tsx` → HomeScreen | **DROP** | Domain. |
| `(main)/messages/` | **DROP** | Domain. |
| `(main)/profile/page.tsx` | **OPEN** | See §OQ. |
| `(main)/sell/page.tsx` | **DROP** | Domain. |
| `cart/page.tsx` | **DROP** | Domain. |
| `category/[id]/page.tsx` | **DROP** | Domain. |
| `listing/[id]/page.tsx` | **DROP** | Domain. |

---

## 5. TOKEN MAP

### Old → Semantic (using fixed role set)

| Mercor token | Hex (light) | Semantic role | Notes |
|---|---|---|---|
| `mercorPrimary` | `#2D5BE3` | **`$primary`** | Main brand/action color. |
| `mercorPrimaryLight` *(dark only; orphan `e` key in light)* | `#7EB3FF` | **`$primaryLight`** | Hover/tint of primary. **Light palette missing this — add it.** |
| `mercorSurface` | `#FFFFFF` | **`$surface`** | Card/panel backgrounds. |
| `mercorBackground` | `#F0F4FF` | **`$background`** | Page/screen background. |
| `mercorTextPrimary` | `#1A1A2E` | **`$textPrimary`** | Body text. |
| `mercorTextSecondary` | `#6B7280` | **`$textSecondary`** | Hint/secondary text. |
| `mercorDanger` | `#EF4444` | **`$danger`** | Errors, destructive actions. |
| `mercorSuccess` | `#22C55E` | **`$success`** | Confirmations, completed states. |
| `mercorGradientStart` | `#C8E6FF` | **`$gradientStart`** | Gradient top. |
| `mercorGradientEnd` | `#4A6FE3` | **`$gradientEnd`** | Gradient bottom. |
| `mercorSurfaceGhost` | `rgba(255,255,255,0.18)` | *(no fixed-role match)* | Semi-transparent surface on gradients. **See "No Semantic Home" below.** |
| `mercorDangerOnGradient` | `#FFB4B4` | *(no fixed-role match)* | Error text over gradient. **See "No Semantic Home" below.** |
| `mercorDarkOverlay` | `rgba(0,0,0,0.2)` | *(no fixed-role match)* | Dark scrim over images. **See "No Semantic Home" below.** |
| `mercorHeaderBlue` | `#4E94F9` | *(no fixed-role match)* | Status-bar bleed color. **See "No Semantic Home" below.** |
| `mercorBottomBar` | `rgb(0,66,158)` | *(no fixed-role match)* | Tab bar background. **See "No Semantic Home" below.** |
| `mercorDarkBlue` | `rgb(0,87,167)` | *(no fixed-role match)* | Defined but unused outside config. **Drop.** |
| `e` (orphan key) | `#7EB3FF` | — | Typo. Should be `mercorPrimaryLight`. **Fix in port.** |

**No fixed-role home (5 tokens require decision):**

| Token | Hex | Disposition options |
|---|---|---|
| `mercorSurfaceGhost` | `rgba(255,255,255,0.18)` | Add `$surfaceGhost` as an extra token outside the fixed set, or inline as literal. |
| `mercorDangerOnGradient` | `#FFB4B4` | Merge into `$danger` (use with opacity), or add `$dangerMuted`. |
| `mercorDarkOverlay` | `rgba(0,0,0,0.2)` | Inline literal or add `$overlay`. |
| `mercorHeaderBlue` | `#4E94F9` | Merge into `$primary` (same brand hue, lighter), or add `$primaryAlt`. Native only (SafeAreaView bleed). |
| `mercorBottomBar` | `rgb(0,66,158)` | Dark navy tab bar — specific to this color scheme. Could be `$navBar`. |

**Fixed roles with no current Mercor token (gaps):**

| Fixed role | Status |
|---|---|
| `$warning` | **MISSING** — no orange/amber token defined anywhere. `OrderStatusBanner` uses `$yellow9` (Tamagui default), not a custom token. Add `$warning` to the palette. |
| `$borderColor` | **PARTIALLY** — OtpInput uses Tamagui's built-in `$borderColor` directly (from defaultConfig); no custom value defined. Consider whether to define a custom value. |
| `$primaryLight` | **MISSING in light palette** (present in dark). Add to light palette. |

---

## 6. DOCS

### Delete from mercor-v2 (Mercor-specific, not porting to template)

| File | Location | Reason |
|---|---|---|
| `MERCOR-PROJECT-SUMMARY.md` | `/Users/.../mercor-v2/MERCOR-PROJECT-SUMMARY.md` | App-specific live state doc. |
| `mercor-frontend-spec.md` | `/Users/.../mercor-v2/mercor-frontend-spec.md` | App-specific frontend spec (palette, routes, screens, copy). |
| `CLAUDE.md` (Mercor's) | `/Users/.../mercor-v2/CLAUDE.md` | App-specific Claude instructions referencing Mercor modules, exchanges, universities. |
| `API-ARCHITECTURE.md` (Mercor's) | `/Users/.../mercor-v2/API-ARCHITECTURE.md` | Template doc — already in `app-template/docs/API-ARCHITECTURE.md`. Do not port; it was authored as the generalized version. |
| `UI-ARCHITECTURE.md` (Mercor's) | `/Users/.../mercor-v2/UI-ARCHITECTURE.md` | Template doc — already in `app-template/docs/UI-ARCHITECTURE.md`. Same situation. |

Note: there is no `mercor-api-spec.md` at the root (the API spec was embedded in the CLAUDE.md / MERCOR-PROJECT-SUMMARY). The generalized replacements (`docs/api-spec.template.md`, `docs/frontend-spec.template.md`, `docs/PROJECT-SUMMARY.template.md`) are already in `app-template/` per CLAUDE.md §0.

---

## OPEN QUESTIONS

Items placed in the strictest bucket pending your decision:

| # | Question | Default (strict) | Recommendation |
|---|---|---|---|
| OQ1 | **`exchangeId` in JWT** — the template keeps `tenantId`. Does the template also need a second-level grouping (exchange = group of tenants)? | DROP `exchangeId`, only `tenantId` in JWT | Drop it from the template; apps that need multi-level groupings add it. |
| OQ2 | **Admin module** — `platform_config` CRUD is generic; exchange/university CRUD is domain-specific. Split into `admin` (platform_config only) + let each app add tenant CRUD? Or drop admin entirely from template? | DROP admin module (placed in DROP bucket) | Keep admin module with only `platform_config` management; drop exchange/university DTOs. |
| OQ3 | **`mercorHeaderBlue` / `$headerPrimary`** — used only for SafeAreaView status-bar bleed in Expo route wrappers. Should this be a named token `$headerPrimary`, or should routes just read `$primary` (same brand family)? | Keep as distinct token `$headerPrimary` | Merge into `$primary` — simplifies the palette. The header is the same brand hue, just lighter (`#4E94F9` vs `#2D5BE3`). |
| OQ4 | **`mercorBottomBar` / `$navBar`** — dark navy (`rgb(0,66,158)`). Is this a named template token or app-specific? | Keep as `$navBar` | Keep — tab bar color is a common design decision that apps will want to override. |
| OQ5 | **ProfileScreen** — avatar card + logout button are generic, but the nav rows (My Listings / Favorites) are domain-specific. Port a stripped-down generic `ProfileScreen` with only avatar + logout + placeholder nav rows, or DROP entirely? | DROP-DOMAIN | Port a stripped-down generic ProfileScreen (avatar + logout + empty nav list) — auth screens are incomplete without it. |
| OQ6 | **SettingsScreen** — currently only a biometric toggle. Fully generic. Keep in template? | KEEP-GENERIC | Yes, keep. It demonstrates the biometric preference pattern with no domain coupling. |
| OQ7 | **`app` package name** — currently bare `app` (not scoped). Port as `@perduraflow/app` (scoped) or keep bare? | Rename to `@perduraflow/app` | Scoped — aligns with `@perduraflow/ui` and `@perduraflow/config`, avoids collision. |
| OQ8 | **`packages/contracts`** — does not exist in mercor-v2 (types live in `packages/ui/src/types.ts`). Should the template create a new `packages/contracts` package, or keep types co-located in `packages/ui`? | No contracts package (status quo) | Create `packages/contracts` for types shared across API/client — cleaner boundary, avoids `@perduraflow/app` importing `@perduraflow/ui` for types. |
| OQ9 | **`mercorDangerOnGradient`** token — used only in GradientScreen error text. Merge into `$danger` (with opacity) or keep as `$dangerMuted`? | Keep as extra token | Merge into `$danger` — simpler palette, callers can add opacity themselves. |
| OQ10 | **`platform_config` table** — keep in template (generic key-value config store) or leave for apps to add? | Keep (KEEP) | Keep — useful for feature flags / runtime config. Already used in the notification module (SMS toggle). |
| OQ11 | **`mercorBottomBar`** on Next.js — the web sidebar (`apps/next/app/(main)/layout.tsx`) uses inline token references but the sidebar itself is domain-specific (Mercor nav items). Drop the whole `(main)/layout.tsx` or provide a blank shell? | DROP | Drop. Apps provide their own main layout. |
| OQ12 | **Turbo vs bun** — mercor-v2 uses `yarn@4.5.0` + `turbo`. Template targets `bun`. The CLAUDE.md is already written for bun. Confirm: the template will swap yarn → bun as part of init? | Yes (per CLAUDE.md) | Confirm this scope is out of PASS 1 (it is). |
