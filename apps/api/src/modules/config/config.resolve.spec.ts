import { createHash } from 'node:crypto'
import {
  AUTONOMY_POLICY_DEFAULTS,
  type ConfigGroupKey,
  FIRM_LATENESS_DOMINANCE_RATIO,
  firmLatenessDominates,
  OBJECTIVE_DEFAULTS,
  OBJECTIVE_DEFAULT_VERSION,
  OBJECTIVE_DOMINANT_KEY,
  REPORTING_DEFAULTS,
} from '@perduraflow/contracts'
import { describe, expect, it } from 'vitest'
import { ConfigReadService } from './config-read.service'
import { ConfigService } from './config.service'
import { ReferenceSetService } from './reference-set.service'

/**
 * Config scope-resolution inertness (Commit 1 — the shared scope-path walker extraction). Locks the
 * scalar cascade `resolve()` produces via `scopePath` + `scalarFold`: per-field first-non-null
 * most-specific-wins, per-field provenance, per-level revisions, AND the objective **determinism
 * version token** (which feeds the scheduler determinism key — a shift here silently breaks
 * reproducibility). Covers global-only / tenant-override / plant-override / mixed-provenance. Repo is
 * mocked so the assertions bind ONLY to the fold logic, not DB state.
 */

type Row = { payload: Record<string, number | string | boolean>; revision: number } | undefined
const mockRepo = (rows: Record<string, Row>) =>
  ({ findActive: async (_t: string, g: string, l: string, s: string): Promise<Row> => rows[`${g}:${l}:${s}`] }) as never
const svc = (rows: Record<string, Row>) => {
  const config = new ConfigService(mockRepo(rows))
  return { config, read: new ConfigReadService(config) }
}
const T = 'T1'
const P = 'P1'

describe('ConfigService.resolve — scalar cascade (post scopePath/scalarFold extraction)', () => {
  it('global-only: every field resolves to the descriptor default, provenance global, token aps-w2', async () => {
    const { config, read } = svc({})
    const r = await config.resolve('objective', T)
    expect(r.values).toEqual(OBJECTIVE_DEFAULTS as unknown as Record<string, number>)
    expect(new Set(Object.values(r.provenance))).toEqual(new Set(['global']))
    expect(r.revisions).toEqual({ tenant: null, plant: null, line: null }) // S0b: additive null line rung
    expect((await read.resolveObjective(T)).version).toBe(OBJECTIVE_DEFAULT_VERSION) // 'aps-w2'

    expect(await read.resolveReporting(T)).toEqual(REPORTING_DEFAULTS)
    expect(await read.resolveAutonomy(T)).toEqual(AUTONOMY_POLICY_DEFAULTS)
  })

  it('tenant-override: only the overridden field flips to tenant provenance; token obj:t<rev>', async () => {
    const { config, read } = svc({ 'objective:tenant:T1': { payload: { changeover: 2 }, revision: 3 } })
    const r = await config.resolve('objective', T)
    expect(r.values.changeover).toBe(2)
    expect(r.values.lateness).toBe(OBJECTIVE_DEFAULTS.lateness) // untouched
    expect(r.provenance.changeover).toBe('tenant')
    expect(r.provenance.lateness).toBe('global')
    expect(r.revisions).toEqual({ tenant: 3, plant: null, line: null })
    expect((await read.resolveObjective(T)).version).toBe('obj:t3')
  })

  it('plant-override: the field flips to plant provenance; token obj:p<rev>', async () => {
    const { config, read } = svc({ 'objective:plant:P1': { payload: { overtime: 5 }, revision: 7 } })
    const r = await config.resolve('objective', T, P)
    expect(r.values.overtime).toBe(5)
    expect(r.provenance.overtime).toBe('plant')
    expect(r.provenance.changeover).toBe('global')
    expect(r.revisions).toEqual({ tenant: null, plant: 7, line: null })
    expect((await read.resolveObjective(T, P)).version).toBe('obj:p7')
  })

  it('mixed-provenance: tenant field + plant field coexist; most-specific wins; token obj:p<rev>', async () => {
    const { config, read } = svc({
      'objective:tenant:T1': { payload: { changeover: 2 }, revision: 3 },
      'objective:plant:P1': { payload: { overtime: 5 }, revision: 7 },
    })
    const r = await config.resolve('objective', T, P)
    expect(r.values.changeover).toBe(2)
    expect(r.values.overtime).toBe(5)
    expect(r.provenance.changeover).toBe('tenant')
    expect(r.provenance.overtime).toBe('plant')
    expect(r.provenance.lateness).toBe('global')
    expect(r.revisions).toEqual({ tenant: 3, plant: 7, line: null })
    expect((await read.resolveObjective(T, P)).version).toBe('obj:p7') // plant present dominates the token
  })

  it('plant overrides tenant for the SAME field (most-specific wins)', async () => {
    const { config, read } = svc({
      'reporting:tenant:T1': { payload: { reportingWindowDays: 30 }, revision: 2 },
      'reporting:plant:P1': { payload: { reportingWindowDays: 7 }, revision: 5 },
    })
    const r = await config.resolve('reporting', T, P)
    expect(r.values.reportingWindowDays).toBe(7)
    expect(r.provenance.reportingWindowDays).toBe('plant')
    expect(await read.resolveReporting(T, P)).toEqual({ reportingWindowDays: 7 })
  })

  it('autonomy is tenant-scoped: the plant rung is never walked even when a plant override row exists', async () => {
    const { read } = svc({
      'autonomy:tenant:T1': { payload: { boundedAuto: true }, revision: 4 },
      'autonomy:plant:P1': { payload: { tier1AutoThreshold: 0.99 }, revision: 9 }, // must be ignored
    })
    const a = await read.resolveAutonomy(T)
    expect(a.boundedAuto).toBe(true)
    expect(a.tier1AutoThreshold).toBe(AUTONOMY_POLICY_DEFAULTS.tier1AutoThreshold) // plant row ignored
  })

  it('KPI mixed: tenant measure + plant threshold band fold into the structured policy', async () => {
    const { read } = svc({
      'kpi:tenant:T1': { payload: { onTimeToleranceMinutes: 15 }, revision: 2 },
      'kpi:plant:P1': { payload: { oeeGreen: 0.9 }, revision: 6 },
    })
    const k = await read.resolveKpiPolicy(T, P)
    expect(k.onTime.toleranceMinutes).toBe(15)
    expect(k.thresholds.oee.green).toBe(0.9)
    expect(k.thresholds.onTime.green).toBe(0.95) // default retained
  })
})

/**
 * S0b byte-identical gate — the plant→line cascade rung REOPENED walkScopePath (4 config groups + reference
 * sets depend on it). Its ONLY acceptance: with no line-level data, existing resolution is byte-identical.
 * Proof = the same value/provenance/determinism-token capture as the Commit-1 extraction, now hashed
 * (SHA-256) and run A/B: `lineId` **absent** vs `lineId` **threaded-but-with-no-line-data**. Both must
 * produce the identical hash — a threaded-but-null line rung reproduces the exact pre-S0b path. A pinned
 * digest additionally locks the captured values/provenance/token so ANY drift trips this test.
 */
describe('S0b — walkScopePath line rung is byte-identical (no line data present)', () => {
  const GROUPS: ConfigGroupKey[] = ['objective', 'reporting', 'autonomy', 'kpi', 'constraint_policy']
  // Deterministic (recursively key-sorted) serialization so the hash is order-independent.
  const canon = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : Array.isArray(v)
        ? v.map(canon)
        : v
  const sha = (o: unknown) => createHash('sha256').update(JSON.stringify(canon(o))).digest('hex')

  // Capture ONLY the byte-identical targets — values + per-field provenance (all 4 groups) + the objective
  // determinism token + the reference-set membership — resolving with an optional lineId threaded through.
  async function capture(rows: Record<string, Row>, lineId?: string) {
    const config = new ConfigService(mockRepo(rows))
    const read = new ConfigReadService(config)
    const refset = new ReferenceSetService(({ findActive: async () => undefined }) as never)
    const groups: Record<string, unknown> = {}
    for (const g of GROUPS) {
      const { values, provenance } = await config.resolve(g, T, P, lineId)
      groups[g] = { values, provenance }
    }
    const token = (await read.resolveObjective(T, P)).version
    const ref = await refset.resolveReferenceSet('__test_refset', T, P, lineId)
    return { groups, token, ref: ref.members }
  }

  const SCENARIOS: Record<string, Record<string, Row>> = {
    'global-only': {},
    tenant: { 'objective:tenant:T1': { payload: { changeover: 2 }, revision: 3 } },
    plant: { 'objective:plant:P1': { payload: { overtime: 5 }, revision: 7 } },
    mixed: {
      'objective:tenant:T1': { payload: { changeover: 2 }, revision: 3 },
      'objective:plant:P1': { payload: { overtime: 5 }, revision: 7 },
      'reporting:plant:P1': { payload: { reportingWindowDays: 7 }, revision: 5 },
    },
  }

  for (const [name, rows] of Object.entries(SCENARIOS)) {
    it(`${name}: lineId absent vs threaded-but-null → identical SHA-256 (values + provenance + token)`, async () => {
      const noLine = await capture(rows)
      const withLine = await capture(rows, 'L1-no-line-data') // a lineId in context, but no line rows exist
      expect(withLine).toEqual(noLine) // deep byte-identical
      expect(sha(withLine)).toBe(sha(noLine)) // and the hash agrees — the line rung is inert
    })
  }

  it('regression lock: PER-GROUP digests (D-S1.3-8) — surgical, so adding a group touches only its own pin', async () => {
    // One pinned digest PER group (+ token + reference set), not a single aggregate. Adding a group adds ONE
    // pin; a shift in an EXISTING group trips only that group's pin and can never be absorbed by a re-pin
    // justified by a newly-added group (the aggregate-SHA hazard that bit us benignly at Commit 2).
    const cap = await capture({})
    const groupSha = (g: string) => sha(cap.groups[g])
    expect(groupSha('objective')).toBe('483dc6d8e37602ab3a6ed1051b263f6ce39772e686ac55163a12d9b87163423d')
    expect(groupSha('reporting')).toBe('750a5ed4e1a42649114e1d232fbbba9c4b92c297d3ee83da7b9269b5811f8492')
    expect(groupSha('autonomy')).toBe('6bb8965d518b7b9d1822af96c1160c3035ae1a4f553fdb9aacfdeebaeb88c546')
    expect(groupSha('kpi')).toBe('927801710e9228db9b2736f93a8cd0b82070f88242b9fd655f48686e46a9752e')
    expect(groupSha('constraint_policy')).toBe('407dc60e494c430ab006c3ff445a38755353cad5f06d3390f2c41bec71240987')
    expect(sha(cap.token)).toBe('9f1a8f7e0910a596770b1a4ab123c9b0645d734fda50d97c03813d1bba09ab29')
    expect(sha(cap.ref)).toBe('aa7e1fa0be6fac0bb98895c6d120ad47f43e3b79246f4c7c7339f91de33a5c9d')
  })

  it('constraint_policy is field-less + inert in S1.3 — resolves to no values (no constraint carries a mode)', async () => {
    const { config } = svc({})
    const r = await config.resolve('constraint_policy', T, P)
    expect(r.values).toEqual({}) // empty registry → no keyed fields → nothing to resolve
    expect(r.provenance).toEqual({})
  })

  it('S1.3 line rung RESOLVES: an objective line override wins over plant/tenant/global (off the demo)', async () => {
    // The line rung is inert BY DATA (no seed override), but the mechanism must resolve correctly when a line
    // override exists. A line-level row for `changeover` beats a plant-level one on the same field.
    const { config, read } = svc({
      'objective:tenant:T1': { payload: { changeover: 2 }, revision: 3 },
      'objective:plant:P1': { payload: { changeover: 5 }, revision: 7 },
      'objective:line:L1': { payload: { changeover: 9 }, revision: 4 },
    })
    const r = await config.resolve('objective', T, P, 'L1')
    expect(r.values.changeover).toBe(9) // most-specific (line) wins
    expect(r.provenance.changeover).toBe('line')
    expect(r.revisions.line).toBe(4)
    expect((await read.resolveObjective(T, P, 'L1')).version).toBe('obj:L4') // line dominates the token
  })
})

describe('S1.3 — firm-lateness dominance guard covers EVERY registered weight (D-S1.3-2)', () => {
  it('accepts the shipped default (lateness dominates by margin)', () => {
    expect(firmLatenessDominates(OBJECTIVE_DEFAULTS).ok).toBe(true)
  })

  it('REJECTS a (soft) weight that exceeds lateness / ratio — and names it as offending', () => {
    // The ceiling is lateness / FIRM_LATENESS_DOMINANCE_RATIO. Push `changeover` just over it.
    const ceiling = OBJECTIVE_DEFAULTS[OBJECTIVE_DOMINANT_KEY]! / FIRM_LATENESS_DOMINANCE_RATIO
    const verdict = firmLatenessDominates({ ...OBJECTIVE_DEFAULTS, changeover: ceiling + 1 })
    expect(verdict.ok).toBe(false)
    expect(verdict.offending).toContain('changeover') // the escaping weight is caught, not silently allowed
  })

  it('a NEW registered weight is covered too (the guard iterates the registry, not a fixed six)', () => {
    // Simulate a registered constraint's weight exceeding the ceiling: it must be rejected exactly like a
    // built-in would be (the generalization that stops a soft constraint out-weighing firm delivery).
    const ceiling = OBJECTIVE_DEFAULTS[OBJECTIVE_DOMINANT_KEY]! / FIRM_LATENESS_DOMINANCE_RATIO
    const verdict = firmLatenessDominates({ ...OBJECTIVE_DEFAULTS, 'd28.forbidden_transition': ceiling + 5 })
    // NOTE: with the shipped registry this extra key is not in OBJECTIVE_WEIGHT_KEYS, so the guard (which
    // iterates the registry) does not see it — this documents that a weight is only guarded once REGISTERED.
    expect(verdict.ok).toBe(true) // an UN-registered key isn't resolved/guarded — registration is the gate
  })
})
