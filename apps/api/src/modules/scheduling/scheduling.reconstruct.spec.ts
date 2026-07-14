import { describe, expect, it } from 'vitest'
import { SchedulingService } from './scheduling.service'
import type { SchedulingRepository } from './scheduling.repository'

/**
 * S1.4 Commit 1 — the REPLAY contract (D-S1.4-4): reconstruction reads the version's RECORDED
 * `constraintSetRef` and never re-resolves from current config (the `masterDataAsof` contract applied to
 * policy). If it re-resolved, a version committed under an old policy would silently reconstruct under the
 * current one — an audit record that lies. A null ref (pre-S1.4 version) falls back to the empty set.
 */

const svc = (version: unknown, csRow: unknown) => {
  const repo = { findVersion: async () => version, getConstraintSet: async () => csRow } as unknown as SchedulingRepository
  const x = undefined as never // the 6 deps reconstructConstraintSet never touches
  return new SchedulingService(repo, x, x, x, x, x, x)
}

describe('reconstructConstraintSet — reads the recorded ref, never re-resolves', () => {
  it('returns the RECORDED content (not current config) — a set that differs from today’s empty set', () => {
    // The recorded set is a (synthetic) NON-empty policy — impossible to produce by re-resolving current
    // config (empty registry). Getting it back proves reconstruction read the record, not re-resolved.
    const recorded = { vocabularyVersion: '1.0.0', constraints: [{ id: 'd28.forbidden', vocabularyVersion: '1.0.0' }], policies: [{ line: 'LINE-1', modes: [{ id: 'd28.forbidden', mode: 'hard', threshold: null }] }] }
    const s = svc({ constraintSetRef: 'abc123' }, { id: 'abc123', content: JSON.stringify(recorded) })
    return s.reconstructConstraintSet('T1', 'V1').then((got) => expect(got).toEqual(recorded))
  })

  it('null constraintSetRef (pre-S1.4 version) → the empty set (the masterDataAsof-style null fallback)', () =>
    svc({ constraintSetRef: null }, undefined)
      .reconstructConstraintSet('T1', 'V1')
      .then((got) => expect(got).toEqual({ vocabularyVersion: '1.0.0', constraints: [], policies: [] })))

  it('a missing constraint_set row → the empty set (defensive; never a throw or a re-resolve)', () =>
    svc({ constraintSetRef: 'gone' }, undefined)
      .reconstructConstraintSet('T1', 'V1')
      .then((got) => expect(got).toEqual({ vocabularyVersion: '1.0.0', constraints: [], policies: [] })))
})
