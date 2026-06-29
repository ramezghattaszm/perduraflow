import { describe, expect, it, vi } from 'vitest'
import type { PredictionDisposition } from '@perduraflow/contracts'
import { AppException } from '../../common/exceptions/app.exception'
import { LearningService } from './learning.service'

/**
 * The manual override (`revertPrediction`, A18 escape hatch) — the boundary to verify hardest is
 * symmetric to approve: ONLY an ADOPTED forecast (auto-committed / approved) can be reverted. A queued
 * or already-disposed one has nothing to undo and must reject WITHOUT touching the overlay. On a valid
 * revert: the overlay is restored from actuals (drop the ml_predicted pre-adopt) and the forecast is
 * marked `reverted` with the dismissal breadcrumb (the one-shot re-arm anchor).
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
  threshold: 0.7875,
  predictedValue: 0.7875,
  appliedLearnedValue: disposition === 'auto_committed' || disposition === 'approved' ? 0.7875 : null,
  crossingAt: new Date('2026-06-27T05:00:00Z'),
})

function serviceFor(found: ReturnType<typeof prediction> | undefined) {
  const upsertLearned = vi.fn(async () => undefined)
  const updatePrediction = vi.fn(async () => undefined)
  const repo = {
    findPredictionById: vi.fn(async () => found),
    findLearned: vi.fn(async () => ({ stdBaseline: 0.75 })),
    actualSeries: vi.fn(async () => [
      { actualCycleTime: 0.75, actualSetupTime: 20 },
      { actualCycleTime: 0.752, actualSetupTime: 20 },
      { actualCycleTime: 0.751, actualSetupTime: 20 },
    ]),
    upsertLearned,
    updatePrediction,
  }
  const events = { publish: vi.fn(async () => undefined) }
  const svc = new LearningService(repo as never, events as never, null as never)
  return { svc, upsertLearned, updatePrediction }
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

describe('revertPrediction — adopted-only override', () => {
  it('reverts an auto-committed forecast: restores the overlay + marks reverted with the breadcrumb', async () => {
    const { svc, upsertLearned, updatePrediction } = serviceFor(prediction('auto_committed'))
    await svc.revertPrediction('t1', 'p1')
    expect(upsertLearned).toHaveBeenCalledTimes(1) // observed overlay restored (ml_predicted dropped)
    expect(updatePrediction).toHaveBeenCalledWith('p1', {
      disposition: 'reverted',
      dismissedAtConfidence: 0.88,
      dismissedAtHorizonMinutes: 500,
    })
  })

  it('reverts an approved forecast (human-applied) the same way', async () => {
    const { svc, updatePrediction } = serviceFor(prediction('approved'))
    await svc.revertPrediction('t1', 'p1')
    expect(updatePrediction).toHaveBeenCalledWith('p1', expect.objectContaining({ disposition: 'reverted' }))
  })

  it('REJECTS a queued forecast (nothing adopted to undo) and does NOT touch the overlay', async () => {
    const { svc, upsertLearned, updatePrediction } = serviceFor(prediction('queued'))
    expect(await codeOf(svc.revertPrediction('t1', 'p1'))).toBe('PREDICTION_NOT_ADOPTED')
    expect(upsertLearned).not.toHaveBeenCalled()
    expect(updatePrediction).not.toHaveBeenCalled()
  })

  it('REJECTS an already-dismissed forecast', async () => {
    const { svc } = serviceFor(prediction('dismissed'))
    expect(await codeOf(svc.revertPrediction('t1', 'p1'))).toBe('PREDICTION_NOT_ADOPTED')
  })

  it('404s when the prediction does not exist for this tenant', async () => {
    const { svc } = serviceFor(undefined)
    expect(await codeOf(svc.revertPrediction('t1', 'nope'))).toBe('PREDICTION_NOT_FOUND')
  })
})
