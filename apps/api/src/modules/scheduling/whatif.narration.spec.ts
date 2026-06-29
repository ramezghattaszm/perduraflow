import { describe, expect, it } from 'vitest'
import type { WhatIfOption } from '@perduraflow/contracts'
import { optionNarrationInput } from './whatif.narration'

/**
 * Comparative facts must carry DIRECTION so the narration gateway can't spin a trade-off into a self-win
 * (the Press A bug: BOTH `overtime` and `defer` narrated as "beats … lower firm-order lateness", though
 * defer's lateness is far HIGHER). Real numbers from that what-if: overtime score 2327.2 / defer 10572,
 * lateness Δ ∓9465.9. The fact for the worse option must say "higher … worse total", never "lower"/"beats".
 */
const opt = (id: string, labelKey: string, score: number, comparatives: unknown): WhatIfOption =>
  ({
    id,
    labelKey,
    feasible: true,
    score,
    kpis: { otif: 0.9, lateOrders: 1, costPerUnit: 10 },
    rationale: { schemaVersion: 1, weightSetVersion: 'x', optionId: id, score, headlineKey: '', headlineParams: {}, factors: [], constraints: [], comparatives },
  }) as unknown as WhatIfOption

const overtime = opt('overtime', 'whatif.option.overtime', 2327.2, [
  { vsOptionId: 'defer', deltaScore: -8244.8, verdict: 'tradeoff', decidingFactors: [{ key: 'lateness', delta: -9465.9 }, { key: 'inventory', delta: 1189.164 }] },
])
const defer = opt('defer', 'whatif.option.defer', 10572, [
  { vsOptionId: 'overtime', deltaScore: 8244.8, verdict: 'tradeoff', decidingFactors: [{ key: 'lateness', delta: 9465.9 }, { key: 'inventory', delta: -1189.164 }] },
])

describe('whatif narration — comparative direction (no self-favorable spin)', () => {
  it('overtime (recommended): better total + LOWER firm-order lateness', () => {
    const facts = optionNarrationInput(overtime, [defer]).facts.join(' ')
    expect(facts).toContain('better total')
    expect(facts).toContain('lower firm-order lateness (by 9465.9)')
    expect(facts).not.toContain('beats')
  })

  it('defer (worse): worse total + HIGHER firm-order lateness — never "lower"/"beats"', () => {
    const facts = optionNarrationInput(defer, [overtime]).facts.join(' ')
    expect(facts).toContain('worse total')
    expect(facts).toContain('Add overtime is preferred')
    expect(facts).toContain('higher firm-order lateness (by 9465.9)')
    // The bug, asserted dead: defer must NOT read as lower-lateness or as beating overtime.
    expect(facts).not.toContain('lower firm-order lateness')
    expect(facts).not.toContain('beats')
  })
})
