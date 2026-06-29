/**
 * Regenerate apps/next/public/tamagui.css from the live Tamagui config.
 *
 * Why this exists: the web root provider links a STATIC `/tamagui.css`
 * (packages/app/provider/NextTamaguiProvider.tsx) and, in PRODUCTION, the runtime
 * `config.getCSS()` excludes `design-system` — so the design-system rules (theme
 * tokens, and crucially the per-size font `letterSpacing`) come ONLY from this file.
 * If it drifts from `packages/config` the prod build renders stale typography (e.g.
 * negative heading letterSpacing → glyphs overlap) while dev (which regenerates the
 * design-system CSS at runtime) looks fine.
 *
 * Run via `bun run generate:css` (and it runs automatically before `next build`).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '@perduraflow/config'

const out = join(import.meta.dir, '..', 'public', 'tamagui.css')
const css = config.getCSS()
writeFileSync(out, css)
console.log(`tamagui.css regenerated (${css.length} bytes) → ${out}`)
// Importing the Tamagui config keeps the event loop alive (timers/schedulers in
// @tamagui/core), so the process won't exit on its own — force it, or `next build`
// (and the Docker RUN step) hangs forever waiting for this script to return.
process.exit(0)
