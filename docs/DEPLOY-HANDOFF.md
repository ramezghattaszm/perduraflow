# Deploy Handoff — Perdura → AWS

Handover for a **fresh session whose only task is AWS deployment.** Everything here is verified against
the repo as of this writing. There is currently **no deploy tooling** (no Dockerfile, no IaC, no deploy
CI — only `.github/workflows/test.yml`). The session builds that.

---

## 1. What ships (three units, two go to AWS)

| Unit | Path | Build | Run (prod) | AWS target |
|---|---|---|---|---|
| **API** (NestJS) | `apps/api` | `nest build` → `dist/` | `node dist/main` | container: ECS Fargate / App Runner / Elastic Beanstalk |
| **Web** (Next.js) | `apps/next` | `next build` | `next start` | **SSR — needs a Node server** (Amplify Hosting *with SSR*, or container). NOT a static export. |
| **Native** (Expo) | `apps/expo` | EAS Build | — | **Not AWS** — app stores via `eas build`/`eas submit`. Out of scope for AWS. |

- **Runtime is Node, not Bun.** Bun is the dev/workspace tool; production runs `node dist/main` (API) and `next start` (web). Use **Node 20+**.
- **Default ports:** API `3010` (env `PORT`), web `3011` (`next start --port`). Put both behind a load balancer / reverse proxy on 443.
- **Monorepo:** bun workspaces (+ turbo for some tasks). A build must `bun install` at the root, then build the shared packages **first** — root `bun run build` does exactly this (`@perduraflow/contracts` → `@perduraflow/config` → `@perduraflow/ui`, an ordered `&&` chain; it does NOT build the apps). Build the API and web with their own filtered commands afterward (§4).

> Naming note: the npm/workspace scope and identifiers are still `perduraflow` (scope `@perduraflow/*`, DB name, cookie prefix, env prefixes). Only the **display name** is "Perdura". Do not rename the scope for deploy.

---

## 2. Database

- **Postgres** (Drizzle ORM). Provision **RDS Postgres** (or Aurora Postgres). One DB; the schema uses
  multiple Postgres **schemas** (`auth`, `org`, `master_data`, `scheduling`, `learning`, `policy`,
  `config`, `binding`, `tenant`) — created by the migrations, no special setup beyond an empty database.
- **Connection:** `DATABASE_URL` (a full `postgresql://…` URL). RDS will need SSL — append `?sslmode=require`
  (and verify the driver accepts it; it's `postgres`/drizzle).
- **Migrations:** `bun --filter @perduraflow/api db:migrate` (= `drizzle-kit migrate`, applies
  `apps/api/drizzle/migrations`). Run this once against RDS before first boot. **Never edit existing
  migrations** (project rule).
- **Seed (optional, demo data):** `db:seed` / `demo:reset` populate the Magna-Coahuila demo tenant +
  warm-start actuals. Only run if you want the demo dataset in the deployed env. `demo:reset` is
  destructive (wipes + reseeds).
- `db:setup` (`scripts/db-setup.sh`) just **creates** the database locally — on RDS you create the DB via
  the console/IaC instead, then run `db:migrate`.

---

## 3. Environment variables

### API (`apps/api`) — Zod-validated at startup, fails fast (`apps/api/src/config/env.ts`)

**Required:**
- `DATABASE_URL` — RDS Postgres URL.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — **≥32 chars each**; generate fresh secrets for prod (store in
  AWS Secrets Manager / SSM, not in the image).

**Should set for prod:**
- `NODE_ENV=production` (also flips the refresh cookie to `Secure` — see §5).
- `PORT` (default 3010).
- `CORS_ORIGIN` — the **web origin** = `https://perdura.thezmgroup.com`. Default is `http://localhost:3011`. CORS runs with `credentials: true`, so this must be the exact browser origin.

**Optional / feature-gated (sensible defaults exist):**
- LLM (Copilot/narration): `LLM_PROVIDER` = `recorded` (default — deterministic, **no external calls**,
  fine for a demo) | `anthropic` | `groq`. If real: set `ANTHROPIC_API_KEY` or `GROQ_API_KEY` (+ optional
  `LLM_MODEL`). `LLM_PROMPT_VERSION` defaults fine.
- Storage: `STORAGE_PROVIDER` = `local` (default) | `s3`. For `s3`: `AWS_S3_BUCKET`, `AWS_REGION`, and creds
  (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) **or** an IAM task role (preferred on ECS — omit static keys).
- Email: `EMAIL_PROVIDER` = `console` (default) | `smtp` (+ `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`).
- JWT TTLs: `JWT_ACCESS_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (90d) — defaults fine.

### Web (`apps/next`) — **build-time** public env

- `NEXT_PUBLIC_API_URL` — the API base **including** `/api/v1` = `https://perduraapi.thezmgroup.com/api/v1`.
  Resolved in `packages/app/lib/api-base.ts`; **baked into the client bundle at `next build`** — it must be
  present at build time, not just runtime. Fallback is `http://localhost:3010/api/v1`.
- (Native equivalent is `EXPO_PUBLIC_API_URL`, set in the EAS build — not AWS.)

---

## 4. Build & run (per unit)

```bash
bun install                                   # root, once
bun run build                                 # shared packages ONLY (contracts → config → ui)

# API
bun --filter @perduraflow/api build           # nest build → apps/api/dist
bun --filter @perduraflow/api db:migrate       # against RDS, once
node apps/api/dist/main                        # serves :3010 (PORT)

# Web  (NEXT_PUBLIC_API_URL must be set for this build)
bun --filter @perduraflow/next build           # next build
bun --filter @perduraflow/next start           # next start --port 3011
```

There are **no Dockerfiles yet** — the session writes them (multi-stage Node 20 images; for the API copy
`dist` + `node_modules` + the `drizzle/migrations` folder; for web, a standard Next standalone/`start`).

---

## 5. AWS-specific gotchas (read before architecting)

1. **Refresh cookie is `sameSite: 'lax'` + `Secure` in prod** (`auth.controller.ts`, name
   `perduraflow_refresh`, path `/api/v1/auth`, host-only). For the web app's silent token refresh to work
   cross-origin:
   - Put web + API under **one parent domain** as subdomains (`app.x.com` + `api.x.com`) → same-site, the
     lax host-only cookie is sent on the refresh XHR. **Both must be HTTPS** (Secure).
   - Set `CORS_ORIGIN` to the exact web origin (CORS already runs `credentials: true`).
   - If you must split across **different registrable domains** (e.g. raw `*.amplifyapp.com` vs a separate
     API domain), `sameSite: 'lax'` will **not** send the cookie cross-site → refresh breaks. Then either
     unify the domain or change the cookie to `sameSite: 'none'` (a one-line code change to flag for the
     owner — don't silently alter auth security posture).
2. **Web is SSR**, not static — don't try `next export`/S3-only. Use Amplify Hosting (Next SSR) or a Node
   container behind CloudFront/ALB.
3. **`NEXT_PUBLIC_API_URL` is build-time** — the web build must know the API URL. A runtime-only env won't
   reach the browser bundle.
4. **Secrets** (DB URL, JWT secrets, LLM/SMTP/AWS keys) → Secrets Manager / SSM Parameter Store, injected
   as env at task start. Prefer an **IAM task role** for S3 over static `AWS_ACCESS_KEY_ID`.
5. **Health check:** there's no dedicated `/health` route today (`GET /api/v1/...` returns 404 at root) —
   the session should add a lightweight health endpoint or point the LB check at a known 200 route.
6. **Migrations on deploy:** run `db:migrate` as a one-off task/init container before the API serves
   traffic; it needs `DATABASE_URL` + the `drizzle/migrations` files in the image.

---

## 6. Decisions — CONFIRMED by the owner

- **Domains (decided):**
  - Web: `https://perdura.thezmgroup.com`
  - API: `https://perduraapi.thezmgroup.com`  (base incl. prefix: `https://perduraapi.thezmgroup.com/api/v1`)
  - Both are subdomains of `thezmgroup.com` → **same-site**, so the `sameSite:'lax'` host-only refresh
    cookie works with no code change. Just ensure: **both on HTTPS** (ACM cert), and set
    `CORS_ORIGIN=https://perdura.thezmgroup.com` on the API. No cookie/auth code change needed.
  - DNS: the parent zone is `thezmgroup.com` — you'll need records (Route 53 or wherever it's hosted)
    pointing `perdura` → web and `perduraapi` → API endpoints.
- **LLM (decided):** same as dev → **Groq**. Set `LLM_PROVIDER=groq` and `GROQ_API_KEY` = the dev Groq key
  (get it from the owner / dev `.env`; store in Secrets Manager). `LLM_MODEL` optional (preset default).
- **Seed (decided):** seed exactly as dev → after `db:migrate`, run the standard seed against the deployed
  DB (`bun --filter @perduraflow/api db:seed`, or `demo:reset` for a clean wipe+seed — the Magna-Coahuila
  demo tenant + warm-start actuals; login `admin@perduraflow.test` / `Password123` — change this before
  any real exposure). Same data as dev.
- **Compute choice (OPEN):** App Runner vs ECS Fargate+ALB vs Amplify(web)+App Runner(API) — **to be
  discussed with the deploy session.** Native/EAS is separate and out of AWS scope.

### Concrete env values implied by the above
```
# API (apps/api)
DATABASE_URL=postgresql://…rds…/<db>?sslmode=require
JWT_ACCESS_SECRET=<fresh ≥32 chars>
JWT_REFRESH_SECRET=<fresh ≥32 chars>
NODE_ENV=production
CORS_ORIGIN=https://perdura.thezmgroup.com
LLM_PROVIDER=groq
GROQ_API_KEY=<dev Groq key>
# storage/email optional — default local/console is fine for the demo

# Web (apps/next) — BUILD TIME
NEXT_PUBLIC_API_URL=https://perduraapi.thezmgroup.com/api/v1
```

---

*Generated as a deploy-only handoff. The app itself is built/working; nothing here changes app behaviour —
it's the operational surface a deployment needs.*
