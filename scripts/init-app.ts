#!/usr/bin/env bun
/**
 * init-app.ts — one-time template initializer.
 *
 * Replaces the three locked template placeholders across the repo, turning the
 * placeholder-state template into a concrete, installable app:
 *
 *   __APP_NAME__   → display name        (app.json, page titles, email copy)
 *   __APP_SLUG__   → slug                (workspace scope @<slug>/*, db name,
 *                                         cookies <slug>_auth/_refresh, scheme,
 *                                         env prefixes, tamagui theme name)
 *   __BUNDLE_ID__  → iOS/Android bundle id
 *
 * Runnable BEFORE `bun install` (Bun executes TS directly), so it is the first
 * thing a new app runs:
 *
 *   bun scripts/init-app.ts --slug acme --name "Acme" --bundle com.acme.app
 *
 * The slug also becomes the npm scope, so it must be a valid scope segment:
 * lowercase, starts with a letter, letters/digits/hyphens only.
 *
 * After substitution it initializes a fresh git repo and makes the first commit,
 * so every app is version-controlled from birth. Pass --no-git to skip.
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { execSync } from 'node:child_process'
import { isValidSlug, isValidBundle } from './lib'

const ROOT = join(import.meta.dirname, '..')

// Directories never walked (build output, vcs, native projects, deps).
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.expo', '.turbo', 'dist', 'build',
  'android', 'ios', '.yarn', 'coverage', 'playwright-report', 'uploads',
])

// Binary / lockfile extensions never rewritten.
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.lock',
  '.gz', '.zip', '.ttf', '.otf', '.woff', '.woff2', '.pdf',
])

// These scripts document the placeholders / wrap this one — never rewrite them.
const SKIP_FILES = new Set([
  join(ROOT, 'scripts', 'init-app.ts'),
  join(ROOT, 'scripts', 'create-app.ts'),
  join(ROOT, 'scripts', 'setup-repo.ts'),
  join(ROOT, 'scripts', 'finalize-app.ts'),
  join(ROOT, 'scripts', 'lib.ts'),
])

interface Args {
  slug: string
  name: string
  bundle: string
  git: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {}
  let git = true
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-git') {
      git = false
      continue
    }
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1]
      if (!val || val.startsWith('--')) fail(`Missing value for --${key}`)
      out[key] = val
      i++
    }
  }
  const { slug, name, bundle } = out
  if (!slug || !name || !bundle) {
    fail('Usage: bun scripts/init-app.ts --slug <slug> --name <name> --bundle <bundle-id>')
  }
  if (!isValidSlug(slug)) {
    fail(`Invalid slug "${slug}". Must be lowercase, start with a letter, and contain only letters, digits, and hyphens (valid npm scope).`)
  }
  if (!isValidBundle(bundle)) {
    fail(`Invalid bundle id "${bundle}". Expected reverse-DNS like com.acme.app.`)
  }
  return { slug, name, bundle, git }
}

function gitInit(name: string): void {
  if (existsSync(join(ROOT, '.git'))) {
    console.log('  (existing git repo detected — skipping git init)')
    return
  }
  try {
    const run = (cmd: string) => execSync(cmd, { cwd: ROOT, stdio: 'ignore' })
    run('git init -q')
    run('git add -A')
    // -c keeps the commit working even if the machine has no global git identity.
    run(`git -c user.name="${name}" -c user.email="dev@${name}.local" commit -q -m "Initial commit from template"`)
    console.log('  ✓ git repository initialized with an initial commit')
  } catch {
    console.log('  (git not available — skipped repo init; run `git init` yourself)')
  }
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      yield* walk(full)
    } else {
      yield full
    }
  }
}

function main(): void {
  const { slug, name, bundle, git } = parseArgs(process.argv.slice(2))

  // Order is safe: the three tokens are disjoint. Replacing __APP_SLUG__ also
  // correctly resolves derived placeholders like __APP_SLUG___auth (shared prefix).
  const replacements: [RegExp, string][] = [
    [/__APP_NAME__/g, name],
    [/__BUNDLE_ID__/g, bundle],
    [/__APP_SLUG__/g, slug],
  ]

  let filesChanged = 0
  let replacementsMade = 0

  for (const file of walk(ROOT)) {
    if (SKIP_FILES.has(file)) continue
    if (SKIP_EXT.has(extname(file))) continue

    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // unreadable / not utf8
    }
    if (!text.includes('__APP_')) continue

    let next = text
    for (const [re, val] of replacements) {
      next = next.replace(re, () => {
        replacementsMade++
        return val
      })
    }
    if (next !== text) {
      writeFileSync(file, next)
      filesChanged++
    }
  }

  console.log(`\n✓ Initialized "${name}"`)
  console.log(`  slug:      ${slug}   (scope @${slug}/*, db ${slug}, cookies ${slug}_auth/${slug}_refresh)`)
  console.log(`  bundle id: ${bundle}`)
  console.log(`  rewrote ${replacementsMade} placeholder(s) across ${filesChanged} file(s)`)

  if (git) gitInit(name)

  console.log('\nNext:')
  console.log('  bun install')
  console.log(`  bun run db:setup && bun --filter @${slug}/api db:migrate && bun --filter @${slug}/api db:seed`)
  console.log(`  bun web   |   bun native   |   bun --filter @${slug}/api dev\n`)
}

main()
