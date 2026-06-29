# App Template

A reusable, cross-platform application template: **Tamagui + Expo + Next.js + NestJS** in a
single **bun** monorepo. One codebase serves web, iOS/Android, and a typed API, with a shared
design system, contracts boundary, and auth + example modules already built and tested.

This repo ships in **placeholder form** — turn it into a concrete app with the init script in
step 1 below before running anything. It is never run directly in placeholder state; instantiate
first. (The init script replaces the app-identity placeholders, including this README, so after
init the commands below show your real workspace scope.)

> Build conventions and the non-negotiable rules live in `CLAUDE.md` and `docs/`. Read those
> before building features. This README is only about **launching** the template.

---

## Stack

| Layer        | Tech                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| UI           | Tamagui · Expo Router (native) · Next.js App Router (web) · Solito (shared navigation) |
| State / data | Zustand · TanStack Query · i18next                                                     |
| API          | NestJS · Drizzle ORM · PostgreSQL · JWT (access + refresh)                             |
| Shared       | `packages/contracts` (Zod schemas + types shared by API and clients)                   |
| Tooling      | bun (workspaces) · Turborepo · TypeScript strict                                       |

The monorepo is **bun-managed**; the API process runs on the **Node** runtime (via Nest).

---

## Prerequisites

- **bun** 1.3+ (package manager + TS runner)
- **Node.js** LTS (the API runs on Node)
- **PostgreSQL** (local or Docker, e.g. `postgres:16`)
- **git** (the init script creates the first commit)
- **openssl** (to generate JWT secrets — preinstalled on macOS/Linux)
- For native development:
  - **iOS:** macOS + **Xcode** (with an iOS Simulator) + **CocoaPods** (`sudo gem install cocoapods` or `brew install cocoapods`)
  - **Android:** **Android Studio** + an emulator (AVD) or device, with `ANDROID_HOME`/SDK on your `PATH`
  - **watchman** recommended on macOS (`brew install watchman`) for Metro file-watching

See Expo's environment setup if anything is missing: https://docs.expo.dev/get-started/set-up-your-environment/

---

## Create an app from this template

Clone the template, then run three scripts — **configure → create repo → provision** — and run.
The example below uses the slug `acme`; substitute your own. Commands shown with `@perduraflow/…`
are rewritten to your scope by step 2.

### 1. Clone

```bash
git clone --depth 1 https://github.com/ramezghattaszm/apptemplate acme && cd acme
```

`--depth 1` keeps the clone shallow — step 3 replaces the template's git history with your own
anyway.

### 2. Configure (`create-app`)

```bash
bun scripts/create-app.ts --name "Acme" --slug acme --bundle com.acme.app
```

Runs before `bun install` (bun executes the TypeScript directly). Replaces the placeholders across
the repo, generates two strong JWT secrets with `node:crypto`, and writes `apps/api/.env` from
`.env.example` (which ships with **safe local defaults** — local file storage, console
email/notifier, localhost services). Run with no flags to be prompted interactively; pass `--db`
(or `--db-host`, `--db-port`, …) to set the database connection. It will not overwrite an existing
`.env` without `--force`, never prints a secret, and touches **no git** and installs **nothing** —
those are the next two steps.

The slug must be a valid npm scope segment: **lowercase, starts with a letter, letters/digits/
hyphens only**. It propagates everywhere app identity appears:

| Input  | Becomes                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| name   | display name in `app.json`, page titles, email copy                                                                                |
| slug   | workspace scope `@perduraflow/*`, database name, cookies `perduraflow_auth` / `perduraflow_refresh`, URL scheme, env prefixes, Tamagui theme name |
| bundle | iOS `bundleIdentifier` / Android `package`                                                                                         |

### 3. Create the repo (`setup-repo`)

```bash
bun scripts/setup-repo.ts
```

Starts a **fresh git history** (the template's ancestry is removed — your app's first commit is its
own `Initial commit`), then creates a private GitHub repo at `github.com/ramezghattaszm/acme` and
pushes. Uses the GitHub CLI — install and sign in first (`brew install gh && gh auth login`).
Options:

- `--public` — public instead of private
- `--owner <name>` (or `GH_OWNER` env) — a different owner/org (default `ramezghattaszm`)
- `--remote <git-url>` — skip `gh` and push to a repo you created yourself

If `gh` is missing or unauthenticated it stops with instructions and creates nothing. Re-running
after a successful push is a no-op. (A `.git` that already points at your own repo is never wiped —
only template ancestry, or no git at all, triggers the fresh init.)

### 4. Provision (`finalize-app`)

```bash
bun scripts/finalize-app.ts
```

Checks that Postgres is reachable (a friendly error, not a stack trace, if it isn't), then runs
`bun install` → `db:setup` → `db:migrate` → `db:seed`. Idempotent; `--skip-install` / `--skip-seed`
to skip steps. The seed creates a single default tenant and an admin user so the app runs
end-to-end out of the box (the email-domain → tenant resolver is a documented extension point, not
the default).

The root `postinstall` builds the shared packages (`config`, `ui`, `contracts`) so the workspace is
runnable immediately. The API validates env with Zod at startup and **fails fast** — if a required
value is missing or too short, it tells you exactly which one.

Client → API URLs (only needed when you boot the clients):

- web: `NEXT_PUBLIC_API_URL` (in `apps/next`)
- native: `EXPO_PUBLIC_API_URL` (in `apps/expo`)

### 5. Run

```bash
bun --filter @perduraflow/api dev      # API   (Node)        → http://localhost:3010/api/v1
bun web                           # web   (Next.js)     → http://localhost:3011
bun native                        # native dev server (Metro) → open on a simulator/device
```

`bun native` starts the Metro dev server; `bun ios` / `bun android` build and launch the native
app. See **Running the apps** below for the full native workflow (first run, simulators, when a
rebuild is needed).

---

## Verify (smoke test)

With the API running, drive the full loop to confirm the wiring:

1. **register** → an OTP is written to the API logs (console email provider)
2. **verify** the OTP → **login**
3. land on the authenticated shell
4. **create an example row**, see it listed
5. (optional) confirm another user gets **403, not 404**, on someone else's row

The API ships an acceptance test covering register → OTP → verify → login, 403-not-404,
admin-sees-all, and soft-delete. A live web/native login additionally exercises the
401 → silent-refresh → retry cycle and the presence-cookie route guard, which the API test
cannot cover on its own — run it once after wiring.

---

## Running the apps

The API must be running for the clients to do anything. Set the client → API URLs first:
`NEXT_PUBLIC_API_URL` in `apps/next`, `EXPO_PUBLIC_API_URL` in `apps/expo` (a simulator can use
`http://localhost:3000/api/v1`; a physical device needs your machine's LAN IP, e.g.
`http://192.168.1.20:3000/api/v1`).

### API (NestJS, on Node)

Requires `apps/api/.env` (step 3) and the database (step 4) to exist first.

```bash
bun --filter @perduraflow/api dev      # watch mode → http://localhost:3000/api/v1
```

On boot it validates env with Zod and **fails fast** — a missing/short var is named explicitly, so
the error message is your checklist. The console email/notifier provider prints OTPs and emails to
the API logs (where you read the OTP during the login smoke test).

```bash
bun --filter @perduraflow/api build    # compile to dist
bun --filter @perduraflow/api start    # run the compiled build (production-style)
```

Database commands (re-run migrate after any schema change; see step 4 for first-time setup):

```bash
bun run db:setup                          # create the perduraflow database
bun --filter @perduraflow/api db:generate      # generate a migration from schema changes
bun --filter @perduraflow/api db:migrate       # apply migrations
bun --filter @perduraflow/api db:seed          # default tenant + admin user + example rows
```

Health check once it's up:

```bash
curl http://localhost:3000/api/v1/health
```

### Web (Next.js)

```bash
bun web        # dev server with hot reload → http://localhost:3001
```

```bash
bun --filter @perduraflow/next build    # production build
bun --filter @perduraflow/next start    # serve the production build
```

### Native (Expo) — two ways to run

There are two distinct modes, and the difference matters:

**a) Dev server (JS only, fast, hot reload)**

```bash
bun native     # = expo start — starts Metro; press i / a to open iOS / Android,
               #   or scan the QR with a dev build / Expo Go
```

Use this for day-to-day work. It serves your JavaScript with hot reload over a native binary
that's already installed. It does **not** rebuild native code.

**b) Build & launch on a simulator/device (compiles native)**

```bash
bun ios        # = expo run:ios     — build the iOS app and launch it (iOS Simulator)
bun android    # = expo run:android — build the Android app and launch it (emulator/device)
```

The **first** time you run native — and any time native code changes — use these. They run
`expo prebuild` (generating the `ios/` and `android/` projects from `app.json`, applying your
bundle id and app name), install pods (iOS), compile, and install the app. This is slow the first
time; subsequent JS changes are picked up by the dev server without rebuilding.

Target a specific simulator/device:

```bash
bun ios --device "iPhone 15 Pro"
bun android --device <emulator-or-device-id>
```

**When you must rebuild** (`bun ios` / `bun android`), not just restart the dev server:

- a native dependency was added or upgraded
- the bundle id, app name, scheme, icons/splash, or any `app.json` native config changed
- a config plugin was added
- first run on a fresh machine, or after deleting `ios/` / `android/`

Otherwise `bun native` + hot reload is enough.

**First-run note:** `create-app.ts` set your bundle id and app name in `app.json`, but those only
materialize into the native projects on prebuild — i.e. on your first `bun ios` / `bun android`.
If you ever change identity later, re-run a native build (or `expo prebuild --clean`).

**Common snags:**

- _Metro can't find a module after an install_ → restart with a clear cache: `bun native --clear`.
- _iOS build fails on pods_ → from `apps/expo`, `cd ios && pod install`, then `bun ios` again.
- _Device can't reach the API_ → you're using `localhost`; switch `EXPO_PUBLIC_API_URL` to your
  machine's LAN IP and ensure both are on the same network.

---

```
apps/
  expo/        iOS + Android (Expo Router)
  next/        Web (Next.js App Router)
  api/         NestJS API (runs on Node)
packages/
  app/         Shared screens, hooks, stores, utils, i18n, lib (axios/token/query)
  ui/          Tamagui components (library-ready; semantic tokens only)
  config/      Tamagui config, palette→semantic tokens, fonts, toast
  contracts/   Zod schemas + types shared by API and clients (the only api↔client surface)
scripts/
  create-app.ts   Step 1 — configure (placeholders + secrets + .env)
  setup-repo.ts   Step 2 — fresh git history + GitHub repo + push
  finalize-app.ts Step 3 — install + database
  init-app.ts     Low-level placeholder initializer (wrapped by create-app)
  lib.ts          Shared slug/bundle validation
CLAUDE.md      Build instructions + non-negotiable rules index
docs/          Architecture docs + per-app spec skeletons
bunfig.toml    Hoisted linker (required)
```

---

## Commands

```bash
# install / build
bun install
bun --filter @perduraflow/config build
bun --filter @perduraflow/ui build

# run
bun --filter @perduraflow/api dev              # API (Node)
bun web                                    # web dev server
bun native                                 # native dev server (Metro)
bun ios                                    # build + launch iOS (simulator)
bun android                                # build + launch Android (emulator/device)
bun native --clear                         # native dev server, cleared Metro cache

# database
bun run db:setup
bun --filter @perduraflow/api db:generate     # generate a migration after a schema change
bun --filter @perduraflow/api db:migrate
bun --filter @perduraflow/api db:seed
bun run demo:reset                        # reset to the deterministic baseline demo state (see below)

# quality
bun run typecheck                         # repo-wide (turbo)
```

### Demo reset

```bash
bun run demo:reset
```

One-step reset to the **deterministic baseline demo state**. Run it before (or between)
demos to get a clean, identical starting point every time.

- **Wipes** all learned values, execution actuals, and schedule versions (including
  post-drift / committed ones) by truncating every app-schema table — migrations/schema
  are untouched (data only).
- **Restores** the seed: same tenant, plants, parts, customer/program + demand lines,
  operators, certifications, and cost rates every run.
- **Rebuilds** the committed baseline schedule through the **real engine** (solve +
  commit via the API — no logic duplicated), so the board opens with **all operations
  `std`**, **0 learned parameters**, and **no variance** (no actuals yet).
- **Idempotent** (run any number of times → identical clean state) and **deterministic**
  (the sequencer is reproducible, D2).

Restores the **Magna de México** scenario (an illustrative, clearly-not-real dataset): 3 plants
(Saltillo Stamping, Ramos Arizpe Welding, Monterrey Components), GM/Stellantis/Nissan/Aftermarket
priority tiers, stamping + weld lines with cost rates, named parts (FG-2001 …), operators + certs,
and the four-collision demand spine (incl. GM `GP-1142`). Post-reset confirmation (printed):

```
• active demand lines  : 8
• committed versions   : 2          # Saltillo + Ramos Arizpe baselines
• scheduled operations : 8 (ml_adjusted = 0, learned = 0 of 8)
• execution actuals    : 0
• variance             : none (no actuals)
```

> **Requires the API running** (it builds the baseline via the real engine). If the API
> is down, the data baseline is still restored and the schedule appears on the planner's
> first **Re-solve**. Demo creds: `admin@perduraflow.test` / `Password123`.

---

## Demo server (AWS)

A low-cost, **single-instance** deployment for live demos. Everything lives in [`infra/`](infra/)
and is driven from your Mac — **no SSH** (access is via AWS SSM Session Manager).

### What it is

One **EC2 `t4g.small`** (Graviton/arm64, Amazon Linux 2023) running the whole stack in
**docker-compose**:

| Container | Role | Public? |
| --------- | ---- | ------- |
| `caddy`   | Reverse proxy + **automatic HTTPS** (Let's Encrypt), routes by host | 80/443 |
| `web`     | Next.js (`next start`, :3011) | via Caddy → `https://perdura.thezmgroup.com` |
| `api`     | NestJS (bun, :3010) | via Caddy → `https://perduraapi.thezmgroup.com` |
| `db`      | Postgres 16 (named volume, host-loopback only) | no |

Images are built on the Mac (native arm64), pushed to **ECR**, and pulled by the instance. There is
**no RDS / ALB / ACM** — Caddy terminates TLS, Postgres runs in a container. Stop the instance
between demos and it costs only EBS + Elastic IP (~$5/mo); ~$18/mo if left running 24/7.

> Runtime note: the images are **bun-based** (the API runs under bun, matching dev). DB migrate and
> reseed run the dev commands as-is inside the `api` container.

### Prerequisites (one-time, on the Mac)

- **AWS CLI v2** signed into the `zmgroup` SSO profile: `aws sso login --profile zmgroup`
  (all scripts pin `--profile zmgroup` + `us-east-1` via [`infra/aws-env.sh`](infra/aws-env.sh) — they
  never touch the default account).
- **Session Manager plugin** (for `connect.sh` / `db-forward.sh`):
  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
- **Docker Desktop** running (for building images).

### First-time deploy (from `infra/`)

```bash
aws sso login --profile zmgroup        # 1. authenticate (browser)

cp .env.example .env                    # 2. create the instance env, then edit it:
#    - generate fresh JWT secrets:  openssl rand -base64 48
#    - set POSTGRES_PASSWORD + matching DATABASE_URL
#    - set GROQ_API_KEY (from dev apps/api/.env)
chmod 600 .env

./provision.sh                          # 3. ECR repos, S3 deploy bucket, IAM role, SG (80/443),
                                        #    EC2 (t4g.small), Elastic IP → writes infra/.deploy-state
./dns.sh                                # 4. Route 53 A records: perdura + perduraapi → Elastic IP
./build-and-push.sh                     # 5. build + push api & web images (arm64) to ECR
./deploy-files.sh                       # 6. push compose/Caddyfile/.env/scripts to /opt/perdura

./run.sh "docker compose --env-file .env up -d db && ./migrate.sh"   # 7. start db + migrate
./run.sh "docker compose --env-file .env up -d"                       # 8. start api + web + caddy
./run.sh "./reseed.sh"                                                # 9. seed the demo data
```

Then verify: `curl https://perduraapi.thezmgroup.com/api/v1/health` → `{"status":"ok"}`, and open
`https://perdura.thezmgroup.com` (login `admin@perduraflow.test` / `Password123`).

### Day-to-day

```bash
./start.sh         # power the instance ON before a demo (containers auto-start)
./stop.sh          # power OFF after a demo — the main cost lever
./connect.sh       # interactive shell on the box (SSM)
./run.sh "<cmd>"   # run one command on the box and print output, e.g.:
./run.sh "docker compose --env-file .env ps"
./run.sh "docker compose --env-file .env logs --tail=100 api"
./run.sh "./reseed.sh"                       # wipe + rebuild the demo data
./db-forward.sh    # tunnel the instance Postgres to localhost:5433 for inspection
```

### Redeploy a code fix

```bash
./build-and-push.sh                                   # rebuild + push both images
#   (or `./build-and-push.sh api` / `./build-and-push.sh web` for just one)
./run.sh "docker compose --env-file .env pull && docker compose --env-file .env up -d"
```

If you changed the compose file, Caddyfile, `.env`, or the db scripts, re-run `./deploy-files.sh`
first to sync them to the box.

### Script reference (`infra/`)

| Script | What it does |
| ------ | ------------ |
| `aws-env.sh` | Sourced by the others: pins `--profile zmgroup` / `us-east-1`, resolves the instance by tag `Name=perdura-demo`, checks auth. |
| `provision.sh` | Idempotent: creates ECR repos, the private S3 deploy bucket, the IAM instance role (SSM + ECR read + S3 read), the security group (80/443 only), the EC2 instance, and the Elastic IP. Writes `infra/.deploy-state`. |
| `dns.sh` | UPSERTs the `perdura` + `perduraapi` A records in the `thezmgroup.com` Route 53 zone → the Elastic IP. |
| `build-and-push.sh` | Builds the api + web images for `linux/arm64` and pushes to ECR. Optional arg `api` or `web` to build just one; `IMAGE_TAG`/`NEXT_PUBLIC_API_URL` overridable. |
| `deploy-files.sh` | Bundles `docker-compose.yml`, `Caddyfile`, the real `.env`, and the db scripts, ships them via the private S3 bucket to `/opt/perdura`, then deletes the S3 copy. |
| `run.sh "<cmd>"` | Runs one shell command on the instance from `/opt/perdura` via SSM and prints stdout/stderr. The main remote-control tool. |
| `connect.sh` | Opens an interactive SSM shell on the instance (no SSH). |
| `start.sh` / `stop.sh` | Power the instance on / off (cost control). |
| `migrate.sh` | (on instance) Runs Drizzle migrations in a one-off `api` container. |
| `reseed.sh` | (on instance) Wipes + rebuilds the demo data inside the running `api` container (runs `reset.ts` under bun). |
| `db-forward.sh` | SSM port-forward of the instance Postgres to `localhost:5433`. |
| `user-data.sh` | EC2 cloud-init (installs Docker + compose plugin, creates `/opt/perdura`). Used by `provision.sh`. |

> `infra/.env` and `infra/.deploy-state` are gitignored — secrets and instance IDs stay local.
> `infra/.env.example` documents every variable.

The deploy design and AWS-specific gotchas are detailed in [`docs/DEPLOY-HANDOFF.md`](docs/DEPLOY-HANDOFF.md).

---

## How the template works

- **Placeholders** — `scripts/init-app.ts` sets the app name, slug, and bundle id throughout the
  repo (this README included) in one pass. Re-running on an already-initialized app is a no-op.
- **`CLAUDE.md`** is the entry point and rules index for building features — read it first.
- **`docs/`** holds the durable architecture docs (`API-ARCHITECTURE.md`, `UI-ARCHITECTURE.md`)
  and the per-app spec skeletons (`api-spec.template.md`, `frontend-spec.template.md`,
  `PROJECT-SUMMARY.template.md`). Copy the skeletons to `*.md` and fill them per app; do **not**
  edit the architecture docs for app-specific decisions.

---

## Notes & gotchas

- **Hoisted linker is required.** `bunfig.toml` sets `linker = "hoisted"`. bun's default isolated
  linker breaks the Tamagui starter, which imports transitive packages it does not declare
  (`@tamagui/core`, `@tamagui/config`, `@tamagui/next-theme`, …). Don't "fix" it back to default.
- **API runs on Node, not bun runtime.** The monorepo is bun-managed, but the Nest process runs on
  Node — keep Node installed.
- **`contracts` emits `dist`.** The Node API consumes compiled contracts at runtime; the root
  `postinstall` builds shared packages so `bun install` leaves everything runnable.
- **Password hashing uses `bcryptjs`** (pure JS, no native build under bun). It's slower than
  native bcrypt — fine for development; revisit (native `bcrypt` or `argon2id`) before production load.
- **Native is bundle-verified, boot it yourself.** `expo export` proves Metro can bundle; it does
  not prove the app boots. Launch `bun native` in a simulator at least once.
- **Tenant isolation is a code-level invariant.** The default resolver is single-tenant, so
  "tenant A cannot see tenant B" is enforced by the JWT-scoped queries but not exercised by the
  shipped tests. A multi-tenant app must add a real two-tenant isolation test.

---

## Building a real app on top

1. `create-app.ts` with your real name/slug/bundle, then `setup-repo.ts` + `finalize-app.ts`.
2. Fill `docs/api-spec.md` and `docs/frontend-spec.md` from the skeletons (palette, tenant model,
   modules, routes).
3. Copy the `example` module as the pattern for each new domain module; build UI from the `H`/`P`
   - component primitives in `packages/ui`.
4. Follow `CLAUDE.md`'s build order and rules.
