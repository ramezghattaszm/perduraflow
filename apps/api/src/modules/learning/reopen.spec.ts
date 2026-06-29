import { describe, expect, it, vi } from 'vitest'
import type { PredictionDisposition } from '@perduraflow/contracts'
import { AppException } from '../../common/exceptions/app.exception'
import { LearningService } from './learning.service'

/**
 * Re-open (the manual path back) — boundary: only a SET-ASIDE forecast (dismissed / reverted) can be
 * re-opened, and it returns as a QUEUED proposal, never a re-adopt. The reverted case is the one to prove:
 * it comes back queued with the adopted value AND the set-aside breadcrumb CLEARED (a fresh proposal — the
 * overlay, restored to standard at revert time, is untouched here), so Approve re-adopts but nothing does
 * silently. A live (queued / auto-committed) forecast has nothing to re-open and must reject.
 */
const prediction = (disposition: PredictionDisposition) => ({
  id: 'p1',
  tenantId: 't1',
  resourceId: 'r1',
  routingOperationId: 'op1',
  param: 'cycle' as const,
  disposition,
  confidence: 0.88,
  horizonMinutes: 500,
  actionTier: 'tier1' as const,
  appliedLearnedValue: disposition === 'reverted' ? 0.7875 : null,
  dismissedAtConfidence: disposition === 'reverted' ? 0.88 : null,
})

function serviceFor(found: ReturnType<typeof prediction> | undefined) {
  const updatePrediction = vi.fn(async () => undefined)
  const repo = { findPredictionById: vi.fn(async () => found), updatePrediction }
  const events = { publish: vi.fn(async () => undefined) }
  const svc = new LearningService(repo as never, events as never, null as never)
  return { svc, updatePrediction, events }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    throw new Error('expected the call to throw, but it resolved')
  } catch (e) {
    if (e instanceof AppException) return e.code
    throw e
  }
}

describe('reopenPrediction — set-aside-only, returns a queued proposal', () => {
  it('re-opens a REVERTED forecast to queued, clearing the adopted value + breadcrumb (reconsiderable, not re-adopt)', async () => {
    const { svc, updatePrediction, events } = serviceFor(prediction('reverted'))
    await svc.reopenPrediction('t1', 'p1')
    expect(updatePrediction).toHaveBeenCalledWith('p1', expect.objectContaining({
      disposition: 'queued',
      appliedLearnedValue: null,
      dismissedAtConfidence: null,
      dismissedAtHorizonMinutes: null,
    }))
    // Back in Need you as a proposal — emits queued, not an adopt event.
    expect(events.publish).toHaveBeenCalled()
  })

  it('re-opens a DISMISSED forecast to queued', async () => {
    const { svc, updatePrediction } = serviceFor(prediction('dismissed'))
    await svc.reopenPrediction('t1', 'p1')
    expect(updatePrediction).toHaveBeenCalledWith('p1', expect.objectContaining({ disposition: 'queued' }))
  })

  it('REJECTS a queued forecast (already live — nothing to re-open)', async () => {
    const { svc, updatePrediction } = serviceFor(prediction('queued'))
    expect(await codeOf(svc.reopenPrediction('t1', 'p1'))).toBe('PREDICTION_NOT_SET_ASIDE')
    expect(updatePrediction).not.toHaveBeenCalled()
  })

  it('REJECTS an auto-committed forecast', async () => {
    const { svc } = serviceFor(prediction('auto_committed'))
    expect(await codeOf(svc.reopenPrediction('t1', 'p1'))).toBe('PREDICTION_NOT_SET_ASIDE')
  })

  it('404s when the prediction does not exist', async () => {
    const { svc } = serviceFor(undefined)
    expect(await codeOf(svc.reopenPrediction('t1', 'nope'))).toBe('PREDICTION_NOT_FOUND')
  })
})
