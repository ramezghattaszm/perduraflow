import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CONSTRAINT_POLICIES } from '@perduraflow/contracts'
import { describe, expect, it } from 'vitest'
import { buildSolveVetoConstraints, ConstraintPolicyResolution, deriveVetoConstraints, MODE_GOVERNED_CONSTRAINTS } from './policy-bridge'

/**
 * S1.2 inertness honesty guard (Commit C) — a PERMANENT regression test that S1.2 stays what it claims to be:
 * a control-flow capability (veto-and-reselect) + a state axis (toolId-keyed busy-interval/tool-life), with
 * **nothing consuming them yet**. Its job is to catch a future session quietly making S1.2 non-inert while
 * still reporting a byte-identical pass — because a byte-identical demo means nothing if a veto/tool is only
 * wired on a code path the seed never hits. The two load-bearing properties (asserted STATICALLY over the
 * production source, so they hold regardless of the seed):
 *   1. NO VETO REGISTERED — no production code registers a `preplaceVeto` / `feasibilityReject` constraint;
 *      the `vetoConstraints` seam is test-only (no non-spec file other than the sequencer even names it).
 *   2. NO TOOL CONSUMED — `toolId` is set/read by no production path but the sequencer's own field + guarded
 *      write, and the `toolBusyIntervals` / `toolLifeUsage` maps are referenced by nothing outside the
 *      sequencer (no consumer, no seed population).
 * The consuming vetoes (D28 forbidden-transition, D9 single-location + tool-life cap, JIS) are S2/S3 — when
 * they land they will (a) register a constraint and (b) read a tool map, tripping this guard on purpose; that
 * is the signal to update it, not to route around it.
 */

const API_SRC = join(__dirname, '..', '..', '..') // apps/api/src

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      out.push(...sourceFiles(p))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(p)
    }
  }
  return out
}

const FILES = sourceFiles(API_SRC)
const rel = (f: string) => f.replace(/.*\/apps\/api\/src\//, '')

/** Every non-spec production source line, tagged with its repo-relative file + 1-indexed line number. */
const LINES = FILES.flatMap((f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .map((text, i) => ({ file: rel(f), where: `${rel(f)}:${i + 1}`, text })),
)

const SEQUENCER = 'modules/scheduling/sequencer.ts'

describe('S1.2 is genuinely inert (no veto registered, no tool consumed) — production source guard', () => {
  it('scanned a non-trivial set of production files (guard is actually running)', () => {
    expect(FILES.length).toBeGreaterThan(20)
    expect(FILES.some((f) => rel(f) === SEQUENCER)).toBe(true)
  })

  it('NO VETO REGISTERED — no production code registers a preplaceVeto/feasibilityReject constraint (array literal)', () => {
    // A registration is an object-key set to an array literal, e.g. `preplaceVeto: [someConstraint()]`. The
    // only production assignment is `preplaceVeto: vetoConstraints?.preplaceVeto` (the test-only seam) — never
    // a literal array. Any `preplaceVeto: [` / `feasibilityReject: [` = a real veto registered → S2/S3.
    const registrations = LINES.filter((l) => /\b(preplaceVeto|feasibilityReject)\s*:\s*\[/.test(l.text)).map((l) => l.where)
    expect(registrations, `a veto constraint is registered in production (S1.2 must stay inert):\n${registrations.join('\n')}`).toEqual([])
  })

  it('NO VETO ENFORCED (S1.3) — the mode→behavior bridge DERIVES an empty veto set at runtime (nothing carries a mode)', () => {
    // S1.3's bridge makes scheduling.service a legitimate caller of the vetoConstraints seam, so the old
    // "named only by the sequencer" static check is REPLACED by the stronger runtime invariant it protected:
    // with no constraint governed by a mode, the DERIVED registration set is empty → no veto is actually
    // enforced. (The array-literal static guard above still forbids a hardcoded registration.) A future
    // D28/D9/JIS consumer populates these registries → this trips by design.
    expect(CONSTRAINT_POLICIES).toEqual([]) // no constraint carries a config mode
    expect(MODE_GOVERNED_CONSTRAINTS).toEqual([]) // no constraint predicate is mode-governed
    const derived = deriveVetoConstraints(MODE_GOVERNED_CONSTRAINTS, new ConstraintPolicyResolution(new Map(), new Map()))
    expect(derived.preplaceVeto).toEqual([])
    expect(derived.feasibilityReject).toEqual([])
  })

  it('NO VETO ENFORCED (seam) — what the solve ACTUALLY threads into sequence() is empty', async () => {
    // Stronger than "the registries are empty": exercise the exact production derivation the solve uses
    // (buildSolveVetoConstraints — the ONLY thing scheduling.service threads as vetoConstraints) with a
    // realistic pre-resolution, and assert the threaded set is empty. Catches a veto built from a non-registry
    // source and passed through the seam (which the : [ regex + registry checks alone would miss).
    const emptyRead = { resolveConstraintPolicy: async () => ({ modes: {} }) }
    const resources = [
      { id: 'R1', lineId: 'LINE-1' },
      { id: 'R2', lineId: null },
    ]
    const threaded = await buildSolveVetoConstraints(emptyRead, 'T1', 'P1', resources)
    expect(threaded.veto.preplaceVeto).toEqual([])
    expect(threaded.veto.feasibilityReject).toEqual([])
  })

  it('NO TOOL CONSUMED — toolId is named only by the sequencer (no seed sets it, no consumer reads it)', () => {
    const foreign = LINES.filter((l) => /\btoolId\b/.test(l.text) && l.file !== SEQUENCER).map((l) => l.where)
    expect(foreign, `a non-sequencer production file references toolId (a seed is populating or a consumer reading it):\n${foreign.join('\n')}`).toEqual([])
  })

  it('NO TOOL CONSUMED — the tool-state maps are referenced by nothing outside the sequencer', () => {
    const foreign = LINES.filter((l) => /\b(toolBusyIntervals|toolLifeUsage)\b/.test(l.text) && l.file !== SEQUENCER).map((l) => l.where)
    expect(foreign, `a non-sequencer production file reads the tool-state maps (that consumer is D9/S2, not S1.2):\n${foreign.join('\n')}`).toEqual([])
  })
})
