import { describe, expect, it } from 'vitest'
import type { ChangeSet, CostedKpis, WhatIfOption } from '@perduraflow/contracts'
import { applySelectability } from './whatif.service'

const kpis = (over: Partial<CostedKpis>): CostedKpis => ({
  otif: 1,
  costPerUnit: 1,
  oee: null,
  lateOrders: 0,
  firmLateHours: 0,
  infeasibleFirmOps: 0,
  throughput: null,
  churn: null,
  ...over,
})

/** A scored option fixture. `infeasible`/`starved` produce the two kinds of non-option. */
const option = (id: string, opts: { infeasible?: number; starved?: boolean; score?: number } = {}): WhatIfOption => ({
  id,
  rank: 1,
  labelKey: `whatif.option.${id}`,
  feasible: !opts.starved,
  infeasibleReasonKey: opts.starved ? 'whatif.infeasible.noResource' : null,
  kpis: kpis({ infeasibleFirmOps: opts.infeasible ?? 0 }),
  score: opts.score ?? 100,
  rationale: { schemaVersion: '1.0', weightSetVersion: 'aps-w2', optionId: id, score: opts.score ?? 100, headlineKey: '', headlineParams: {}, factors: [], constraints: [], comparatives: [] },
})

const remediation: ChangeSet = { origin: { type: 'manual' }, changes: [{ kind: 'at_risk_remediation', demandLineId: 'MF-102' }] }
const demandChange: ChangeSet = { origin: { type: 'manual' }, changes: [{ kind: 'demand_qty', demandLineId: 'DL-1', to: 100 }] }

describe('applySelectability — infeasible-plan options are non-options', () => {
  it('≥1 selectable → offers ONLY selectable; non-options re-labeled feasible:false; recommended = first selectable', () => {
    // The MF-102 shape: one option resolves it (faster_operator), the rest leave it un-runnable.
    const opts = [
      option('faster_operator', { score: 339 }),
      option('overtime', { infeasible: 2, score: 400 }),
      option('reroute', { infeasible: 2, score: 250 }),
      option('balanced', { infeasible: 2, score: 245 }),
    ]
    const r = applySelectability(opts, remediation)
    expect(r.unremediable).toBeNull()
    expect(r.recommendedOptionId).toBe('faster_operator')
    // Still ALL present (re-label, not hard-drop — so consumers can demote them to context), but only
    // the selectable one stays feasible; the rest are flipped to non-options with the unrunnable reason.
    expect(r.options.filter((o) => o.feasible).map((o) => o.id)).toEqual(['faster_operator'])
    const overtime = r.options.find((o) => o.id === 'overtime')!
    expect(overtime.feasible).toBe(false)
    expect(overtime.infeasibleReasonKey).toBe('whatif.infeasible.unrunnableOp')
  })

  it('a STARVED option (already feasible:false) is non-selectable and keeps its own reason', () => {
    const r = applySelectability([option('faster_operator'), option('reroute', { starved: true })], remediation)
    expect(r.recommendedOptionId).toBe('faster_operator')
    expect(r.options.find((o) => o.id === 'reroute')!.infeasibleReasonKey).toBe('whatif.infeasible.noResource') // unchanged
  })

  it('recommended = the best-RANKED selectable (input order), not the lowest-score non-option', () => {
    // reroute/balanced score lower but are infeasible — must NOT be picked over the feasible faster_operator.
    const r = applySelectability([option('faster_operator', { score: 339 }), option('balanced', { infeasible: 1, score: 1 })], remediation)
    expect(r.recommendedOptionId).toBe('faster_operator')
  })

  it('0 selectable + remediation → honest-unachievable with the TAILORED levers', () => {
    const r = applySelectability([option('overtime', { infeasible: 2 }), option('reroute', { starved: true })], remediation)
    expect(r.recommendedOptionId).toBeNull()
    expect(r.unremediable).toEqual({ reasonKey: 'whatif.unremediable.atRisk', leversKey: 'whatif.unremediable.atRiskLevers' })
    // CRITICAL: when unremediable, NO option leaks through as feasible (else a consumer filtering on
    // `feasible` would tile a non-running plan). All re-labeled feasible:false.
    expect(r.options.every((o) => !o.feasible)).toBe(true)
  })

  it('0 selectable + general change-set → honest-unachievable with a GENERIC reason (no levers)', () => {
    const r = applySelectability([option('balanced', { infeasible: 1 })], demandChange)
    expect(r.unremediable).toEqual({ reasonKey: 'whatif.unremediable.generic', leversKey: null })
  })

  it('all feasible (the common case) → INERT: every option offered, no re-label, no verdict', () => {
    const opts = [option('balanced'), option('reroute'), option('overtime')]
    const r = applySelectability(opts, demandChange)
    expect(r.unremediable).toBeNull()
    expect(r.options).toEqual(opts) // byte-identical — the safety check
    expect(r.recommendedOptionId).toBe('balanced')
  })
})
