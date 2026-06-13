#!/usr/bin/env bun
/**
 * create-app.ts — step 1 of the bootstrap: CONFIGURE the files (no git, no install).
 *
 * Wraps the focused low-level `init-app.ts` (placeholder substitution) and adds
 * the human-facing parts: prompting for the app identity, generating strong JWT
 * secrets, and writing `apps/api/.env`. It does NOT touch git or install anything
 * — those are the next two scripts:
 *
 *   bun scripts/create-app.ts ...   # 1. configure (this script)
 *   bun scripts/setup-repo.ts       # 2. fresh git history + GitHub repo + push
 *   bun scripts/finalize-app.ts     # 3. install + database
 *
 *   bun scripts/create-app.ts                                  # interactive
 *   bun scripts/create-app.ts --name "Acme" --slug acme --bundle com.acme.app
 *
 * Flags override prompts, so it works both interactively and in CI. Anything not
 * passed is prompted for (display name required; slug/bundle default sensibly).
 * Database connection settings default to a local Postgres unless `--db` (prompt)
 * or explicit `--db-*` flags are given.
 *
 * Flags:
 *   --name <s>        display name (required; prompted if omitted)
 *   --slug <s>        workspace slug (default: slugify(name))
 *   --bundle <s>      iOS/Android bundle id (default: com.<slug>.app)
 *   --db              prompt for database settings even in non-interactive mode
 *   --db-host <s>     default localhost      --db-port <n>  default 5432
 *   --db-user <s>     default postgres       --db-password <s> default postgres
 *   --db-name <s>     default <slug>
 *   --force           overwrite an existing apps/api/.env
 */

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface, type Interface } from 'node:readline'
import { isValidBundle, isValidSlug, slugify } from './lib'

const ROOT = join(import.meta.dirname, '..')
const ENV_EXAMPLE = join(ROOT, 'apps', 'api', '.env.example')
const ENV_FILE = join(ROOT, 'apps', 'api', '.env')

interface Flags {
  name?: string
  slug?: string
  bundle?: string
  db: boolean
  'db-host'?: string
  'db-port'?: string
  'db-user'?: string
  'db-password'?: string
  'db-name'?: string
  force: boolean
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

/** Parses argv: `--bool` flags and `--key value` pairs; unknown keys are kept. */
function parseFlags(argv: string[]): Flags {
  const bools = new Set(['db', 'force'])
  const out: Record<string, string | boolean> = { db: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) fail(`Unexpected argument "${a}".`)
    const key = a.slice(2)
    if (bools.has(key)) {
      out[key] = true
      continue
    }
    const val = argv[i + 1]
    if (val === undefined || val.startsWith('--')) fail(`Missing value for --${key}`)
    out[key] = val
    i++
  }
  return out as unknown as Flags
}

/** Generates a strong, .env-safe secret (base64url → no `/ + =` to confuse parsers). */
const genSecret = () => randomBytes(48).toString('base64url') // 64 chars, > 32 min

/**
 * Minimal line-prompt over `node:readline`. Built by hand (rather than
 * `readline/promises`) because that API's `question()` pauses the input stream
 * and doesn't reliably resume for a second question under Bun — which breaks
 * multi-prompt flows when stdin is piped. This queues every 'line' event so each
 * `ask()` consumes the next line whether it arrives interactively or all at once.
 */
class Prompter {
  private readonly rl: Interface
  private readonly queue: string[] = []
  private waiting: ((line: string) => void) | null = null
  private closed = false

  constructor() {
    this.rl = createInterface({ input: stdin })
    this.rl.on('line', (line) => {
      if (this.waiting) {
        const w = this.waiting
        this.waiting = null
        w(line)
      } else {
        this.queue.push(line)
      }
    })
    this.rl.on('close', () => {
      this.closed = true
      if (this.waiting) {
        const w = this.waiting
        this.waiting = null
        w('')
      }
    })
  }

  /** Asks a question, returning the trimmed answer or `def` when the line is blank. */
  ask(question: string, def?: string): Promise<string> {
    stdout.write(def ? `${question} [${def}]: ` : `${question}: `)
    return new Promise<string>((resolve) => {
      const give = (line: string) => resolve(line.trim() || def || '')
      const queued = this.queue.shift()
      if (queued !== undefined) give(queued)
      else if (this.closed) give('')
      else this.waiting = give
    })
  }

  close(): void {
    this.rl.close()
  }
}

/** Lazily-created prompter, so fully-flagged runs never touch stdin. */
let prompter: Prompter | null = null
function ask(question: string, def?: string): Promise<string> {
  if (!prompter) prompter = new Prompter()
  return prompter.ask(question, def)
}

async function collectIdentity(flags: Flags): Promise<{ name: string; slug: string; bundle: string }> {
  // Name (required).
  let name = flags.name?.trim() ?? ''
  if (!name) {
    while (!name) name = await ask('App display name')
  }

  // Slug (default: slugify(name)).
  const slugDefault = slugify(name)
  let slug = flags.slug?.trim() ?? ''
  if (slug) {
    if (!isValidSlug(slug)) fail(`Invalid slug "${slug}". Lowercase, start with a letter, letters/digits/hyphens only.`)
  } else if (flags.name) {
    // Non-interactive (name came from a flag): use the derived default, fail fast if unusable.
    slug = slugDefault
    if (!isValidSlug(slug)) fail(`Could not derive a valid slug from "${name}". Pass --slug explicitly.`)
  } else {
    // Interactive: prompt, re-asking until valid.
    do {
      slug = await ask('Slug (npm scope, db name)', isValidSlug(slugDefault) ? slugDefault : undefined)
      if (!isValidSlug(slug)) console.error('  ✗ lowercase, start with a letter, letters/digits/hyphens only.')
    } while (!isValidSlug(slug))
  }

  // Bundle id (default: com.<slug>.app).
  const bundleDefault = `com.${slug}.app`
  let bundle = flags.bundle?.trim() ?? ''
  if (bundle) {
    if (!isValidBundle(bundle)) fail(`Invalid bundle id "${bundle}". Expected reverse-DNS like com.acme.app.`)
  } else if (flags.name) {
    bundle = bundleDefault
  } else {
    do {
      bundle = await ask('Bundle id', bundleDefault)
      if (!isValidBundle(bundle)) console.error('  ✗ expected reverse-DNS like com.acme.app.')
    } while (!isValidBundle(bundle))
  }

  return { name, slug, bundle }
}

interface Db {
  host: string
  port: string
  user: string
  password: string
  name: string
}

async function collectDb(flags: Flags, slug: string): Promise<Db> {
  const defaults: Db = {
    host: flags['db-host'] ?? 'localhost',
    port: flags['db-port'] ?? '5432',
    user: flags['db-user'] ?? 'postgres',
    password: flags['db-password'] ?? 'postgres',
    name: flags['db-name'] ?? slug,
  }
  // Prompt only when --db is passed or we're running interactively (no name flag).
  const interactive = !flags.name
  if (!flags.db && !interactive) return defaults

  console.log('\nDatabase connection (press enter to accept defaults):')
  return {
    host: await ask('  DB host', defaults.host),
    port: await ask('  DB port', defaults.port),
    user: await ask('  DB user', defaults.user),
    password: await ask('  DB password', defaults.password),
    name: await ask('  DB name', defaults.name),
  }
}

/**
 * Writes apps/api/.env from .env.example: fills the real JWT secret keys (any
 * `JWT_*SECRET` present) with fresh independent secrets and DATABASE_URL from the
 * db inputs, leaving every other key at its example default. Returns the names of
 * the keys it set (never the values).
 */
function writeEnv(db: Db): string[] {
  const example = readFileSync(ENV_EXAMPLE, 'utf8')
  const dbUrl = `postgresql://${db.user}:${db.password}@${db.host}:${db.port}/${db.name}`

  // Discover the actual secret key names from the example (don't assume).
  const secretKeys = Array.from(example.matchAll(/^\s*(JWT_[A-Z0-9_]*SECRET)\s*=/gm)).map((m) => m[1])
  const values = new Map<string, string>([['DATABASE_URL', dbUrl]])
  for (const key of secretKeys) values.set(key, genSecret())

  const set: string[] = []
  const next = example
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*)([A-Z][A-Z0-9_]*)\s*=/)
      if (m && values.has(m[2])) {
        set.push(m[2])
        return `${m[2]}=${values.get(m[2])}`
      }
      return line
    })
    .join('\n')

  writeFileSync(ENV_FILE, next)
  return set
}

function printNextSteps(name: string): void {
  console.log(`\n✓ ${name} configured.\n`)
  console.log('Next:')
  console.log('  bun scripts/setup-repo.ts      # create your git repo + push')
  console.log('  bun scripts/finalize-app.ts    # install + database\n')
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  // 1. Collect + validate everything BEFORE touching the filesystem.
  const { name, slug, bundle } = await collectIdentity(flags)
  const db = await collectDb(flags, slug)

  // Refuse to clobber an existing .env early, before init-app runs.
  if (existsSync(ENV_FILE) && !flags.force) {
    prompter?.close()
    fail(`apps/api/.env already exists. Re-run with --force to overwrite it (the new secrets will replace the old).`)
  }
  prompter?.close()

  // 2. Run init-app for placeholder substitution only. Always --no-git: git is
  //    setup-repo's job. Must run before writeEnv so .env.example is slug-resolved
  //    (db name, cookie names).
  console.log('\nConfiguring template…')
  execSync(
    `bun scripts/init-app.ts --slug ${JSON.stringify(slug)} --name ${JSON.stringify(name)} --bundle ${JSON.stringify(bundle)} --no-git`,
    { cwd: ROOT, stdio: 'inherit' },
  )

  // 3 + 4. Generate secrets and write apps/api/.env (gitignored).
  const setKeys = writeEnv(db)
  console.log(`\n✓ wrote apps/api/.env (${setKeys.join(', ')}) — secrets not shown`)

  printNextSteps(name)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
