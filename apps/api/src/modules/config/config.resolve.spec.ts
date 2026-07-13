import { createHash } from 'node:crypto'
import {
  AUTONOMY_POLICY_DEFAULTS,
  type ConfigGroupKey,
  OBJECTIVE_DEFAULTS,
  OBJECTIVE_DEFAULT_VERSION,
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

  it('regression lock: the five-group + reference-set resolution hashes to the pinned digest', async () => {
    // Pinned digest of the global-only capture — the known-good output (values + provenance + token +
    // members). If any group's value, provenance, or determinism token EVER shifts, this trips. Re-pinned
    // at S1.3 when the inert `constraint_policy` group joined the capture (it resolves to no fields → the
    // only delta is an empty group entry; the four prior groups' captures are unchanged).
    expect(sha(await capture({}))).toBe('07f75aa166b2a3b809019efbf6ad26ec3dbcc000fbf59a72a8674c37713873b4')
  })

  it('constraint_policy is field-less + inert in S1.3 — resolves to no values (no constraint carries a mode)', async () => {
    const { config } = svc({})
    const r = await config.resolve('constraint_policy', T, P)
    expect(r.values).toEqual({}) // empty registry → no keyed fields → nothing to resolve
    expect(r.provenance).toEqual({})
  })
})
