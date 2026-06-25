import { describe, expect, it } from 'vitest'
import { type CallInCandidate, pickCallIn } from './scheduling.service'

const cand = (
  over: Partial<CallInCandidate> & Pick<CallInCandidate, 'id' | 'absenceReason'>
): CallInCandidate => ({
  name: `Op-${over.id}`,
  laborRate: 25,
  ...over,
})

/**
 * The OT call-in eligibility ladder (D54): off-shift (`not_scheduled`) first → a clean call-in;
 * else `vacation` → a TENTATIVE call-in (confirm first); `sick` is NEVER callable. Ties break by
 * cheapest labor rate, then id. No callable candidate → null (the gap is honestly unfillable).
 */
describe('pickCallIn — call-in eligibility ladder', () => {
  it('prefers a not_scheduled operator — a clean (non-tentative) call-in', () => {
    const fill = pickCallIn([cand({ id: 'a', absenceReason: 'not_scheduled' })])
    expect(fill).toMatchObject({ id: 'a', absenceReason: 'not_scheduled', tentative: false })
  })

  it('excludes sick even when it is the cheapest option', () => {
    // Luis is sick AND cheapest; Jorge is off-shift and pricier — the engine must still pick Jorge.
    const fill = pickCallIn([
      cand({ id: 'luis', absenceReason: 'sick', laborRate: 20 }),
      cand({ id: 'jorge', absenceReason: 'not_scheduled', laborRate: 27 }),
    ])
    expect(fill).toMatchObject({ id: 'jorge', tentative: false })
  })

  it('not_scheduled beats vacation regardless of cost (tier wins over price)', () => {
    const fill = pickCallIn([
      cand({ id: 'vac', absenceReason: 'vacation', laborRate: 10 }),
      cand({ id: 'off', absenceReason: 'not_scheduled', laborRate: 99 }),
    ])
    expect(fill).toMatchObject({ id: 'off', absenceReason: 'not_scheduled', tentative: false })
  })

  it('falls back to vacation when no off-shift operator — flagged TENTATIVE', () => {
    const fill = pickCallIn([
      cand({ id: 'sick1', absenceReason: 'sick' }),
      cand({ id: 'pedro', absenceReason: 'vacation' }),
    ])
    expect(fill).toMatchObject({ id: 'pedro', absenceReason: 'vacation', tentative: true })
  })

  it('returns null when only sick (or unknown-reason) candidates exist — unfillable gap', () => {
    expect(pickCallIn([cand({ id: 'sick1', absenceReason: 'sick' })])).toBeNull()
    expect(pickCallIn([cand({ id: 'unknown', absenceReason: null })])).toBeNull()
    expect(pickCallIn([])).toBeNull()
  })

  it('within the same tier, cheapest labor rate wins, then id', () => {
    const fill = pickCallIn([
      cand({ id: 'b', absenceReason: 'not_scheduled', laborRate: 30 }),
      cand({ id: 'a', absenceReason: 'not_scheduled', laborRate: 22 }),
      cand({ id: 'c', absenceReason: 'not_scheduled', laborRate: 22 }),
    ])
    expect(fill?.id).toBe('a') // cheapest (22); 'a' before 'c' on id tie-break
  })
})
