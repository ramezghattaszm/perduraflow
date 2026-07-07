import {
  AUTONOMY_POLICY_DEFAULTS,
  OBJECTIVE_DEFAULTS,
  OBJECTIVE_DEFAULT_VERSION,
  REPORTING_DEFAULTS,
} from '@perduraflow/contracts'
import { describe, expect, it } from 'vitest'
import { ConfigReadService } from './config-read.service'
import { ConfigService } from './config.service'

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
    expect(r.revisions).toEqual({ tenant: null, plant: null })
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
    expect(r.revisions).toEqual({ tenant: 3, plant: null })
    expect((await read.resolveObjective(T)).version).toBe('obj:t3')
  })

  it('plant-override: the field flips to plant provenance; token obj:p<rev>', async () => {
    const { config, read } = svc({ 'objective:plant:P1': { payload: { overtime: 5 }, revision: 7 } })
    const r = await config.resolve('objective', T, P)
    expect(r.values.overtime).toBe(5)
    expect(r.provenance.overtime).toBe('plant')
    expect(r.provenance.changeover).toBe('global')
    expect(r.revisions).toEqual({ tenant: null, plant: 7 })
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
    expect(r.revisions).toEqual({ tenant: 3, plant: 7 })
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
