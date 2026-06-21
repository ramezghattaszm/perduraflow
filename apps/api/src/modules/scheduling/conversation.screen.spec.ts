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
  })

  it('omits the CURRENT SCREEN block when there is no context (Pass A regression)', () => {
    const prompt = buildSystemPrompt(CATALOG.orders, CATALOG.resources, 2, null)
    expect(prompt).not.toContain('CURRENT SCREEN')
    expect(prompt).not.toContain('A NAMED entity ALWAYS WINS')
  })
})
