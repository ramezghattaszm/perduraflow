# PerduraFlow — API Spec

> App-specific API decisions. The reusable patterns live in `API-ARCHITECTURE.md` — this file
> only records what is unique to PerduraFlow. Fill each section; delete guidance notes as you go.

---

## 1. Domain modules & table ownership

> One module per domain. Each module owns its tables; no other module writes to them.
> (Boundary rules: API-ARCHITECTURE.md §3.)

| Module | Owns tables |
|---|---|
| `example` | _(replace with real modules)_ |

---

## 2. Tenant / scope key

> Per API-ARCHITECTURE.md §4. Name the scope boundary and where it comes from.

- Scope key: _(e.g. `tenantId` / `orgId` / `none`)_
- Source: _(how it's resolved at login and placed in the JWT)_
- Single-tenant for now? _(yes/no — column still present per the rule)_

---

## 3. Auth specifics

- Refresh token lifetime: _(template default 90d — set here)_
- OTP in use? _(yes/no; if yes: length, expiry, resend policy)_
- Roles: _(list app roles beyond `admin`)_
- Biometric login (native): _(yes/no)_

---

## 4. Error codes (app-specific)

> Universal codes ship in the template (API §5). Add domain codes here; mirror them in
> the frontend's `errors.json`.

```ts
// e.g.
// RESOURCE_ALREADY_EXISTS, RESOURCE_LOCKED, ...
```

---

## 5. Providers in use

> Which pluggable providers (API §10) this app enables, and the env var per provider.

| Concern | Env var | Providers |
|---|---|---|
| _(e.g. storage)_ | `STORAGE_PROVIDER` | `s3`, `local` |

---

## 6. Environment variables (app-specific)

> Beyond the universal set in API §12. Add to the Zod schema.

```
# e.g. SMTP_*, STORAGE_*, third-party API keys
```

---

## 7. Real-time / WebSocket

- Used? _(yes/no)_
- Namespaces / rooms: _(if yes)_

---

## 8. Open API decisions

| ID | Question | Status |
|---|---|---|
| | | |
