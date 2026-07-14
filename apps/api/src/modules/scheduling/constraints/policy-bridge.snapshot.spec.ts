import { describe, expect, it } from 'vitest'
import type { ResolvedConstraintPolicy } from '@perduraflow/contracts'
import { buildConstraintSet, canonicalConstraintSetJson, ConstraintPolicyResolution, digestConstraintSet, PLANT_SCOPE_KEY } from './policy-bridge'

/**
 * S1.4 Commit 1 — the D6 constraint-set snapshot serialization. Content-addressing only works if the
 * serialization is deterministic, byte-faithful (round-trips), and the empty digest is EMERGENT (not a
 * special case that a future non-empty set could accidentally hit). These lock exactly that.
 */

const resolution = (byLine: [string | null, ResolvedConstraintPolicy][], resourceLine: [string, string | null][] = []) =>
  new ConstraintPolicyResolution(new Map(byLine), new Map(resourceLine))

const EMPTY = resolution([], [['R1', 'LINE-1'], ['R2', null]]) // resourceLine populated, byLine empty (the inert shape)

describe('D6 constraint-set snapshot (S1.4)', () => {
  it('empty resolved set → a CONSTANT digest, deterministic across calls (the inert content-address)', () => {
    const a = digestConstraintSet(buildConstraintSet(EMPTY))
    const b = digestConstraintSet(buildConstraintSet(resolution([], []))) // different resourceLine, same (empty) policy
    expect(a).toBe(b) // resourceLine (topology) is NOT part of the set → same empty policy → same digest
    expect(buildConstraintSet(EMPTY)).toEqual({ vocabularyVersion: '1.0.0', constraints: [], policies: [] })
  })

  it('the digest is pinned (a shift here means the canonical serialization changed)', () => {
    expect(digestConstraintSet(buildConstraintSet(EMPTY))).toBe('9f13e84c39c5c4913314022eb7b0422e4813954f25a71314107f61fc6d6a8d77')
  })

  it('serialize() reads ACTUAL content — no isEmpty short-circuit (isEmpty is a registry check, not this instance)', () => {
    // byLine is populated here, but isEmpty still returns true (CONSTRAINT_POLICIES is empty). The serializer
    // must emit the real content regardless — the emergent-not-special-cased guarantee (D-S1.4-2's reasoning).
    const r = resolution([['LINE-1', { modes: { 'c.one': { mode: 'hard', threshold: null } } }]], [['R1', 'LINE-1']])
    expect(r.isEmpty).toBe(true) // registry check — unaffected by this instance's content
    expect(r.serialize().policies).toEqual([{ line: 'LINE-1', modes: [{ id: 'c.one', mode: 'hard', threshold: null }] }])
  })

  it('the null (plant) line key serializes under the PLANT_SCOPE_KEY sentinel (JSON has no null key)', () => {
    const r = resolution([[null, { modes: { 'c.two': { mode: 'soft', threshold: null } } }]])
    expect(r.serialize().policies[0]!.line).toBe(PLANT_SCOPE_KEY)
    expect(PLANT_SCOPE_KEY).not.toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/) // can never collide with a ULID lineId
  })

  it('serialization is order-independent + round-trips byte-faithfully', () => {
    // lines/modes inserted out of order → identical canonical JSON (sorted); parse round-trips to the same set.
    const a = buildConstraintSet(resolution([['LINE-2', { modes: { b: { mode: 'soft', threshold: null }, a: { mode: 'hard', threshold: 3 } } }], ['LINE-1', { modes: {} }]]))
    const b = buildConstraintSet(resolution([['LINE-1', { modes: {} }], ['LINE-2', { modes: { a: { mode: 'hard', threshold: 3 }, b: { mode: 'soft', threshold: null } } }]]))
    expect(canonicalConstraintSetJson(a)).toBe(canonicalConstraintSetJson(b)) // key/line/mode order-independent
    expect(JSON.parse(canonicalConstraintSetJson(a))).toEqual(a) // byte-faithful round-trip
  })

  it('a mode change produces a DIFFERENT digest (the drift-detection content-address)', () => {
    const hard = digestConstraintSet(buildConstraintSet(resolution([['LINE-1', { modes: { c: { mode: 'hard', threshold: null } } }]])))
    const soft = digestConstraintSet(buildConstraintSet(resolution([['LINE-1', { modes: { c: { mode: 'soft', threshold: null } } }]])))
    const slack = digestConstraintSet(buildConstraintSet(resolution([['LINE-1', { modes: { c: { mode: 'hard-with-slack', threshold: 5 } } }]])))
    expect(new Set([hard, soft, slack]).size).toBe(3) // each distinct policy → a distinct ref
    expect(hard).not.toBe(digestConstraintSet(buildConstraintSet(EMPTY))) // and none is the empty-set digest
  })
})
