import { describe, expect, it } from 'vitest'
import type { ScreenContext } from '@perduraflow/contracts'
import { buildSystemPrompt, renderScreenContext } from './conversation.service'

const CATALOG = {
  orders: [
    { demandLineId: 'GP-1142', releaseReference: 'GM-830-1142', customer: 'GM', part: 'FG-2001', qty: 600, firmness: 'firm', due: '2026-06-22' },
    { demandLineId: 'DL-2004', releaseReference: 'STL-862-2004', customer: 'Stellantis', part: 'FG-3002', qty: 200, firmness: 'forecast', due: '2026-06-25' },
  ],
  resources: [{ id: 'res-A', name: 'Press Line A' }],
}

describe('renderScreenContext — Pass B screen snapshot', () => {
  it('renders the selected order by its release reference and the line by name', () => {
    const sc: ScreenContext = { screen: 'board', view: 'day', selectedOrderId: 'GP-1142', selectedResourceId: 'res-A', activeResultId: 'wir-1' }
    const line = renderScreenContext(sc, CATALOG)
    expect(line).toContain('screen board (day view)')
    expect(line).toContain('selected order GP-1142 (GM-830-1142)')
    expect(line).toContain('selected line Press Line A')
    expect(line).toContain('a what-if analysis is open on screen')
  })

  it('is null without screen context (→ pure Pass A behavior)', () => {
    expect(renderScreenContext(undefined, CATALOG)).toBeNull()
  })

  it('omits a selection that is not present', () => {
    const line = renderScreenContext({ screen: 'board' }, CATALOG)
    expect(line).toBe('screen board')
  })

  it('phrases the scorecard referent (arm + scope) naturally (Pass C)', () => {
    expect(renderScreenContext({ screen: 'scorecard', view: 'frozen_engine_snapshot', selectedResourceId: 'res-A' }, CATALOG)).toBe(
      'the scorecard — the engine-lift comparison, scope Press Line A',
    )
    expect(renderScreenContext({ screen: 'scorecard', view: 'measured_historical' }, CATALOG)).toBe(
      'the scorecard — the measured-historical comparison, scope the whole plant',
    )
  })

  it('phrases the exception-queue referent (selected at-risk order) naturally (Pass C)', () => {
    expect(renderScreenContext({ screen: 'exception', selectedOrderId: 'DL-2004' }, CATALOG)).toBe(
      'the exception queue — at-risk order DL-2004 (STL-862-2004) selected',
    )
    expect(renderScreenContext({ screen: 'exception' }, CATALOG)).toBe('the exception queue (no order selected)')
  })

  it('phrases the workforce referent (operator selected vs not) (Pass D)', () => {
    expect(renderScreenContext({ screen: 'workforce', selectedOperatorId: 'op-1' }, CATALOG)).toContain('an operator selected')
    expect(renderScreenContext({ screen: 'workforce' }, CATALOG)).toBe('the workforce coverage view (no operator selected)')
  })
})

describe('buildSystemPrompt — Pass B precedence (named wins / deictic→screen / no-selection→ask)', () => {
  it('includes the CURRENT SCREEN block and the precedence rules when context is present', () => {
    const prompt = buildSystemPrompt(CATALOG.orders, CATALOG.resources, 2, 'screen board, selected order GP-1142 (GM-830-1142)')
    expect(prompt).toContain('CURRENT SCREEN: the planner is viewing screen board, selected order GP-1142 (GM-830-1142).')
    // named ALWAYS overrides screen context (guards the inverse bug)
    expect(prompt).toContain('A NAMED entity ALWAYS WINS')
    expect(prompt).toContain('IGNORE the on-screen selection')
    // deictic resolves to the selection
    expect(prompt).toMatch(/DEICTIC[\s\S]*on-screen selection/)
    // deictic with no selection → ask, never null-resolve/guess
    expect(prompt).toContain('ASK which one — do NOT fall back')
    // Pass D-coverage: the deferral line is gone (coverage now retrievable); the only boundary
    // left is the PERMANENT labor boundary — explain coverage, never assign.
    expect(prompt).not.toContain('cannot pull coverage detail yet')
    expect(prompt).toContain('Labor boundary (permanent)')
    expect(prompt).toContain('Never assign')
  })

  it('omits the CURRENT SCREEN block when there is no context (Pass A regression)', () => {
    const prompt = buildSystemPrompt(CATALOG.orders, CATALOG.resources, 2, null)
    expect(prompt).not.toContain('CURRENT SCREEN')
    expect(prompt).not.toContain('A NAMED entity ALWAYS WINS')
  })
})
