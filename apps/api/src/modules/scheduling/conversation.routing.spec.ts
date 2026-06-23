import { describe, expect, it } from 'vitest'
import type { ChangeSet } from '@perduraflow/contracts'
import { buildSystemPrompt, renderActiveScenario } from './conversation.service'

const catalog = {
  orders: [
    {
      demandLineId: 'DL-2003',
      releaseReference: 'GM-830-2003',
      customer: 'GM',
      part: 'FG-3001',
      qty: 100,
      firmness: 'firm',
      due: '2026-06-25',
    },
  ],
  resources: [{ id: 'res-weld', name: 'Weld Cell 1' }],
}

/**
 * Routing + context-carry for scenario construction follow-ups (the "give me a fourth option using
 * overtime" gap): the prompt must (A) route "another option with a new lever" to CONSTRUCTION, not
 * retrieval, and (B) carry the active scenario's change-set + at-risk line so the follow-up inherits
 * them. These lock the deterministic surfaces (the LLM route is driven by this prompt).
 */
describe('renderActiveScenario — carried change-set, human-readable', () => {
  it('renders a compound (demand qty + overtime) by release reference and line name', () => {
    const cs: ChangeSet = {
      origin: { type: 'demand' },
      changes: [
        { kind: 'demand_qty', demandLineId: 'DL-2003', to: 140 },
        { kind: 'overtime', resourceId: 'res-weld', hours: 4 },
      ],
    }
    const s = renderActiveScenario(cs, catalog)
    expect(s).toBe('set DL-2003 (GM-830-2003) quantity to 140; add 4h overtime on Weld Cell 1')
  })
})

describe('buildSystemPrompt — routing rules (A)', () => {
  const p = buildSystemPrompt([], [], 0, null)

  it('routes "another/a fourth option with a new lever" to construction, not retrieve', () => {
    expect(p).toContain('SCENARIO CONSTRUCTION')
    expect(p).toMatch(/another \(or a fourth\) option/)
    expect(p).toContain('does NOT mean retrieve when a NEW lever is named')
  })

  it('routes an amount-less overtime ask to goal_seek (engine finds the hours), never decline', () => {
    expect(p).toContain('WITHOUT a value')
    expect(p).toContain('goal_seek (the engine finds the hours)')
    expect(p).toContain('Never decline for a missing number')
  })
})

describe('buildSystemPrompt — context carry (B)', () => {
  it('includes a CURRENT SCENARIO block with the carried change-set + at-risk default line', () => {
    const p = buildSystemPrompt([], [], 0, null, 'set DL-2003 (GM-830-2003) quantity to 140', [
      'Weld Cell 1',
    ])
    expect(p).toContain('CURRENT SCENARIO')
    expect(p).toContain('set DL-2003 (GM-830-2003) quantity to 140')
    expect(p).toContain('compound')
    expect(p).toContain('Firm at-risk in the committed plan is on: Weld Cell 1')
  })

  it('omits the CURRENT SCENARIO block when no scenario is active', () => {
    expect(buildSystemPrompt([], [], 0, null)).not.toContain('CURRENT SCENARIO')
  })
})
