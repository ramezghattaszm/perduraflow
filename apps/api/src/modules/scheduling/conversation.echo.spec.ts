import { describe, expect, it } from 'vitest'
import type { RequestedChange } from '@perduraflow/contracts'
import { renderChangeEcho } from './conversation.service'

/**
 * The structure-derived change-set echo (conversation Pass A) is the visible-faithfulness
 * mechanism: every Type-2 answer leads with it, rendered from the engine's ledger (never LLM
 * prose). These lock the never-MISREPRESENT invariant — an applied change is shown, and a
 * partial/unapplied change is ALWAYS surfaced so a half-executed compound can't read as done.
 */
describe('renderChangeEcho — never-silently-drop echo (Pass A)', () => {
  it('lists applied changes under "Applied"', () => {
    const ledger: RequestedChange[] = [
      { kind: 'demand_date', summary: 'move GP-1142 due date to 2026-06-27', status: 'applied', note: null },
      { kind: 'overtime', summary: 'add 4h overtime on Press Line A', status: 'applied', note: null },
    ]
    const echo = renderChangeEcho(ledger)
    expect(echo).toContain('**Applied:**')
    expect(echo).toContain('move GP-1142 due date to 2026-06-27')
    expect(echo).toContain('add 4h overtime on Press Line A')
    expect(echo).not.toContain('Not applied')
  })

  it('ALWAYS surfaces an unapplied change under "Not applied" with its reason', () => {
    const ledger: RequestedChange[] = [
      { kind: 'demand_date', summary: 'move GP-1142 due date to 2026-06-27', status: 'applied', note: null },
      { kind: 'overtime', summary: 'add 6h overtime on Leak-Test Station', status: 'unapplied', note: 'Leak-Test Station has no overtime allowance' },
    ]
    const echo = renderChangeEcho(ledger)
    // the delay is shown as applied AND the overtime is explicitly called out as not applied —
    // the compound can never read as fully done.
    expect(echo).toContain('**Applied:** move GP-1142 due date to 2026-06-27.')
    expect(echo).toContain('**Not applied:** add 6h overtime on Leak-Test Station — Leak-Test Station has no overtime allowance.')
  })

  it('shows a clamp note inline for a partial change (honored but adjusted)', () => {
    const ledger: RequestedChange[] = [
      { kind: 'overtime', summary: 'add 12h overtime on Press Line A', status: 'partial', note: 'clamped to 4h — Press Line A overtime ceiling' },
    ]
    const echo = renderChangeEcho(ledger)
    expect(echo).toContain('add 12h overtime on Press Line A (clamped to 4h — Press Line A overtime ceiling)')
  })

  it('is empty for an empty ledger (non-Type-2 turns add no echo)', () => {
    expect(renderChangeEcho([])).toBe('')
  })
})
