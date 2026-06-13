#!/usr/bin/env bun
/**
 * setup-repo.ts — step 2 of the bootstrap: own the whole git lifecycle.
 *
 * Starts a clean history (no template ancestry), makes the first commit, then
 * creates the GitHub repo and pushes. Run after `create-app.ts` (configure) and
 * before `finalize-app.ts` (install + db).
 *
 *   bun scripts/setup-repo.ts                       # gh repo create <owner>/<slug> --private
 *   bun scripts/setup-repo.ts --public              # public instead of private
 *   bun scripts/setup-repo.ts --owner my-org        # different owner (or GH_OWNER env)
 *   bun scripts/setup-repo.ts --remote <git-url>    # skip gh; push to an existing repo
 *
 * Clean-history guard: the destructive `rm -rf .git` happens ONLY when there is
 * no `.git` or its `origin` is the template (ramezghattaszm/apptemplate). A `.git`
 * with any other origin is treated as this app's own repo and never wiped — its
 * history is preserved and the run is just a commit + push.
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const TEMPLATE = 'ramezghattaszm/apptemplate'
const DEFAULT_OWNER = 'ramezghattaszm'

interface Flags {
  owner?: string
  public: boolean
  remote?: string
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = { public: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) fail(`Unexpected argument "${a}".`)
    const key = a.slice(2)
    if (key === 'public') {
      out.public = true
      continue
    }
    if (key === 'owner' || key === 'remote') {
      const val = argv[i + 1]
      if (val === undefined || val.startsWith('--')) fail(`Missing value for --${key}`)
      out[key] = val
      i++
      continue
    }
    fail(`Unknown flag --${key}`)
  }
  return out
}

/** Runs a git command in ROOT, returning trimmed stdout (throws on non-zero). */
function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** Runs a git command, streaming output; throws on non-zero. */
function gitRun(args: string[]): void {
  execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' })
}

/** Returns the result of a git command, or null if it exits non-zero. */
function gitTry(args: string[]): string | null {
  try {
    return git(args)
  } catch {
    return null
  }
}

/** Reads the slug from the root package.json `name` (set by create-app/init-app). */
function resolveSlug(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name?: string }
  const slug = pkg.name ?? ''
  if (!slug || slug.includes('__APP_')) {
    fail('Template is not configured yet. Run `bun scripts/create-app.ts` first.')
  }
  return slug
}

/** True when `gh` exists on PATH and an account is authenticated. */
function ghReady(): boolean {
  try {
    execSync('command -v gh', { stdio: 'ignore' })
  } catch {
    return false
  }
  try {
    execSync('gh auth status', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function ghInstructions(owner: string, slug: string): never {
  console.error('\n✗ GitHub CLI (gh) is not available or not authenticated.\n')
  console.error('Fix it one of two ways, then re-run:\n')
  console.error('  A) Install + sign in to gh:')
  console.error('       brew install gh && gh auth login')
  console.error('       bun scripts/setup-repo.ts\n')
  console.error('  B) Create the repo yourself, then attach it:')
  console.error(`       1. Create an empty repo at https://github.com/${owner}/${slug}`)
  console.error(`       2. bun scripts/setup-repo.ts --remote https://github.com/${owner}/${slug}.git\n`)
  process.exit(1)
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2))
  const slug = resolveSlug()
  const owner = flags.owner ?? process.env.GH_OWNER ?? DEFAULT_OWNER
  const visibility = flags.public ? '--public' : '--private'

  // ── Step 2: clean-history guard (non-destructive inspection first) ──────────
  const hasGit = existsSync(join(ROOT, '.git'))
  const originUrl = hasGit ? gitTry(['remote', 'get-url', 'origin']) : null
  const isTemplateOrigin = Boolean(originUrl && originUrl.includes(TEMPLATE))
  const keepHistory = hasGit && !isTemplateOrigin && originUrl !== null
  const wipe = !hasGit || isTemplateOrigin

  // Decide early whether this run will need gh, and preflight BEFORE any
  // destructive action so a missing gh never leaves a half-set-up repo.
  const willCreate = !flags.remote && !(keepHistory && originUrl)
  if (willCreate && !ghReady()) ghInstructions(owner, slug)

  if (wipe) {
    if (hasGit) {
      console.log(
        isTemplateOrigin
          ? '• Removing template git history (origin was the template)…'
          : '• Initializing git…',
      )
      rmSync(join(ROOT, '.git'), { recursive: true, force: true })
    }
    gitRun(['init', '-b', 'main'])
  } else {
    console.log('• Existing repository detected (own origin) — keeping its history.')
  }

  // ── Step 3: first commit (skip when there is nothing to commit) ─────────────
  gitRun(['add', '-A'])
  const hasHead = gitTry(['rev-parse', '--verify', 'HEAD']) !== null
  const dirty = (gitTry(['status', '--porcelain']) ?? '') !== ''
  if (!hasHead || dirty) {
    gitRun(['commit', '-q', '-m', 'Initial commit'])
    console.log('• Committed.')
  } else {
    console.log('• Nothing to commit.')
  }
  gitRun(['branch', '-M', 'main'])

  // ── Step 4: create + attach + push ──────────────────────────────────────────
  let repoUrl: string
  const originNow = gitTry(['remote', 'get-url', 'origin'])

  if (flags.remote) {
    if (!originNow) gitRun(['remote', 'add', 'origin', flags.remote])
    else if (originNow !== flags.remote) gitRun(['remote', 'set-url', 'origin', flags.remote])
    gitRun(['push', '-u', 'origin', 'main'])
    repoUrl = flags.remote.replace(/\.git$/, '')
  } else if (originNow) {
    // History kept with an existing origin → just push (idempotent no-op push).
    gitRun(['push', '-u', 'origin', 'main'])
    repoUrl = originNow.replace(/\.git$/, '')
  } else {
    // Fresh repo → let gh create it, wire origin, and push in one step.
    console.log(`• Creating ${owner}/${slug} on GitHub…`)
    execFileSync(
      'gh',
      ['repo', 'create', `${owner}/${slug}`, visibility, '--source=.', '--remote=origin', '--push'],
      { cwd: ROOT, stdio: 'inherit' },
    )
    repoUrl = `https://github.com/${owner}/${slug}`
  }

  console.log(`\n✓ Repository ready: ${repoUrl}\n`)
  console.log('Next:')
  console.log('  bun scripts/finalize-app.ts    # install + database\n')
}

main()
