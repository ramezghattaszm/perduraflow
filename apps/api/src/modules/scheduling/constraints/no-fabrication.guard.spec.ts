import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Fabrication-model guard (S1.1 Commit 6) — a permanent regression test that the corrected two-scope authority
 * (SELECTION stateful + PLACEMENT per-job; no ORDERING scope; changeover = SELECTION rank term only) is not
 * re-contradicted in code comments. The ordering structure was mis-modeled three times (flat per-candidate;
 * two-tier "static-ORDERING + changeover-as-placement-cost"; three-scope "items.sort on (dueMs,seqIndex)") —
 * this locks the vocabulary so those fabrications can't creep back into a docstring and mislead S2+.
 */

const SCHEDULING_DIR = join(__dirname, '..') // apps/api/src/modules/scheduling

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(p)
  }
  return out
}

const FILES = sourceFiles(SCHEDULING_DIR)

/** Every non-spec source line, tagged with its file + 1-indexed line number. */
const LINES = FILES.flatMap((f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .map((text, i) => ({ where: `${f.replace(/.*\/scheduling\//, 'scheduling/')}:${i + 1}`, text })),
)

/** Phrases that assert the fabricated ordering models — none may appear anywhere. */
const FORBIDDEN: RegExp[] = [
  /two-tier/i,
  /three-scope/i,
  /ordering tier/i,
  /setup-cost/i, // changeover is a SELECTION rank term, never a placement setup-cost
  /edd is the base/i,
  /edd's home/i,
  /seqindex/i,
  /items\.sort/i,
]

describe('no fabrication-model authority language survives in scheduling/', () => {
  it.each(FORBIDDEN.map((re) => [re.source, re] as const))('forbids /%s/', (_src, re) => {
    const hits = LINES.filter((l) => re.test(l.text)).map((l) => l.where)
    expect(hits, `fabrication phrase re-introduced at:\n${hits.join('\n')}`).toEqual([])
  })

  it('the only ORDERING-scope reference is the inert-seam label "no ORDERING scope"', () => {
    const bad = LINES.filter((l) => /ordering scope/i.test(l.text) && !/no ordering scope/i.test(l.text)).map((l) => l.where)
    expect(bad, `unlabelled "ORDERING scope" (must read "no ORDERING scope"):\n${bad.join('\n')}`).toEqual([])
  })

  it('scanned a non-trivial set of source files (guard is actually running)', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })
})
