#!/usr/bin/env bun
/**
 * finalize-app.ts — step 3 of the bootstrap: PROVISION (install + database).
 *
 * Run after `create-app.ts` (configure) and `setup-repo.ts` (git + GitHub). It
 * installs dependencies and brings the database up, then prints the run guide. It
 * touches NO git — that is exclusively setup-repo's job.
 *
 *   bun scripts/finalize-app.ts                 # bun install → db:setup → migrate → seed
 *   bun scripts/finalize-app.ts --skip-install  # skip `bun install`
 *   bun scripts/finalize-app.ts --skip-seed     # skip the seed step
 *
 * Idempotent: every step is safe to re-run. Preflights that the app is configured
 * (apps/api/.env present) and that Postgres is reachable, failing with a friendly
 * message rather than a raw stack trace.
 */

import { execSync } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const ENV_FILE = join(ROOT, 'apps', 'api', '.env')

interface Flags {
  'skip-install': boolean
  'skip-seed': boolean
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = { 'skip-install': false, 'skip-seed': false }
  for (const a of argv) {
    if (a === '--skip-install') out['skip-install'] = true
    else if (a === '--skip-seed') out['skip-seed'] = true
    else fail(`Unknown argument "${a}".`)
  }
  return out
}

/** Reads the slug from the root package.json `name` (set during configure). */
function resolveSlug(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name?: string }
  const slug = pkg.name ?? ''
  if (!slug || slug.includes('__APP_')) {
    fail('Template is not configured yet. Run `bun scripts/create-app.ts` first.')
  }
  return slug
}

/** Pulls a single key's value out of a dotenv file's text. */
function readEnvValue(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'))
  return m?.[1]?.trim().replace(/^["']|["']$/g, '')
}

/** Resolves true once a TCP connection to host:port succeeds within the timeout. */
function canConnect(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function preflightPostgres(): Promise<void> {
  const text = readFileSync(ENV_FILE, 'utf8')
  const url = readEnvValue(text, 'DATABASE_URL')
  if (!url) fail('DATABASE_URL is missing from apps/api/.env. Re-run `bun scripts/create-app.ts`.')

  let host = 'localhost'
  let port = 5432
  try {
    const parsed = new URL(url)
    host = parsed.hostname || host
    port = parsed.port ? Number(parsed.port) : port
  } catch {
    fail(`DATABASE_URL in apps/api/.env is not a valid URL: ${url}`)
  }

  if (!(await canConnect(host, port))) {
    fail(
      `Postgres is not reachable at ${host}:${port}.\n` +
        '  Start it, then re-run this script. For example:\n' +
        '    • Docker:   docker compose up -d   (or `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres`)\n' +
        '    • Homebrew: brew services start postgresql',
    )
  }
  console.log(`✓ Postgres reachable at ${host}:${port}`)
}

function printRunGuide(slug: string): void {
  console.log(`\n✓ ${slug} is provisioned.\n`)
  console.log('Run:')
  console.log(`  bun --filter @${slug}/api dev     # API  → http://localhost:3000/api/v1`)
  console.log('  bun web                          # web  → http://localhost:3001')
  console.log('  bun native                       # native dev server (Metro)')
  console.log('  bun ios                          # build + launch iOS simulator')
  console.log('  bun android                      # build + launch Android emulator\n')
  console.log('Notes:')
  console.log('  • Register a user, then read the OTP from the API logs (console provider) to verify.')
  console.log("  • Physical device: set EXPO_PUBLIC_API_URL to your machine's LAN IP, not localhost.\n")
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  // ── Preflight ───────────────────────────────────────────────────────────────
  if (!existsSync(ENV_FILE)) {
    fail('apps/api/.env not found. Run `bun scripts/create-app.ts` first to configure the app.')
  }
  const slug = resolveSlug()
  await preflightPostgres()

  // ── Provision ───────────────────────────────────────────────────────────────
  const run = (cmd: string) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
  if (!flags['skip-install']) {
    console.log('\n• Installing dependencies…')
    run('bun install')
  }
  console.log('\n• Setting up the database…')
  run('bun run db:setup')
  run(`bun --filter @${slug}/api db:migrate`)
  if (!flags['skip-seed']) run(`bun --filter @${slug}/api db:seed`)

  printRunGuide(slug)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
