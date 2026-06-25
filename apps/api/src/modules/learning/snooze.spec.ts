import { describe, expect, it } from 'vitest'
import { RULE, snoozeDecision } from './learning.rule'

// A dismissed forecast snapshotted at 60% confidence / 48h horizon; defaults from RULE.
const base = {
  tier: 'tier1' as const,
  dismissedConfidence: 0.6,
  dismissedHorizonMinutes: 48 * 60,
  tier1AutoThreshold: 0.97,
  confDelta: RULE.SNOOZE_CONF_DELTA, // 0.15
  urgencyMinutes: RULE.SNOOZE_URGENCY_MINUTES, // 1440 (24h)
}

/**
 * The snooze "materially worse" decision (D-snooze). Dismissing sets a forecast aside; it re-asks
 * ONLY when confidence rises ≥ delta above the dismissal level, OR the crossing enters the imminent
 * band having been outside it at dismissal; escalates to auto-commit past the auto-threshold. The
 * default case — a small wobble on the next actual — must STAY snoozed (the fix).
 */
describe('snoozeDecision', () => {
  it('STAYS snoozed on a small change (next actual, ~same confidence + horizon) — the fix', () => {
    expect(snoozeDecision({ ...base, newConfidence: 0.62, newHorizonMinutes: 47 * 60 })).toBe(
      'stay'
    )
  })

  it('re-surfaces when confidence rises ≥ delta above the dismissal level', () => {
    expect(snoozeDecision({ ...base, newConfidence: 0.75, newHorizonMinutes: 47 * 60 })).toBe(
      'resurface'
    )
    // just under the delta still stays
    expect(snoozeDecision({ ...base, newConfidence: 0.74, newHorizonMinutes: 47 * 60 })).toBe(
      'stay'
    )
  })

  it('re-surfaces when the crossing enters the imminent band (was outside at dismissal)', () => {
    expect(snoozeDecision({ ...base, newConfidence: 0.62, newHorizonMinutes: 12 * 60 })).toBe(
      'resurface'
    )
  })

  it('does NOT re-surface on urgency if it was ALREADY imminent at dismissal (the "was above" guard)', () => {
    expect(
      snoozeDecision({
        ...base,
        dismissedHorizonMinutes: 6 * 60,
        newConfidence: 0.62,
        newHorizonMinutes: 3 * 60,
      })
    ).toBe('stay')
  })

  it('escalates to auto-commit when Tier-1 confidence crosses the auto-threshold (acts, not re-asks)', () => {
    expect(snoozeDecision({ ...base, newConfidence: 0.98, newHorizonMinutes: 47 * 60 })).toBe(
      'auto_commit'
    )
  })

  it('never auto-commits a tier-2 forecast, even at high confidence (the gate is not bypassable)', () => {
    expect(
      snoozeDecision({ ...base, tier: 'tier2', newConfidence: 0.99, newHorizonMinutes: 47 * 60 })
    ).toBe('resurface')
  })

  it('honors a configured (tighter) delta — re-surfaces sooner than the default', () => {
    // delta 0.05 → +0.07 over dismissal now re-surfaces (would have stayed under the 0.15 default)
    expect(
      snoozeDecision({ ...base, confDelta: 0.05, newConfidence: 0.67, newHorizonMinutes: 47 * 60 })
    ).toBe('resurface')
  })

  it('honors a configured (wider) urgency band — re-surfaces earlier on horizon', () => {
    // urgency 72h → a 60h crossing (was 48h? no: dismissed at 96h) enters the band
    expect(
      snoozeDecision({
        ...base,
        dismissedHorizonMinutes: 96 * 60,
        urgencyMinutes: 72 * 60,
        newConfidence: 0.62,
        newHorizonMinutes: 60 * 60,
      })
    ).toBe('resurface')
  })
})
