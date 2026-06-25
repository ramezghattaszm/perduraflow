import { describe, expect, it, vi } from 'vitest'
import type { ScheduleVersionStatus } from '@perduraflow/contracts'
import { AppException } from '../../common/exceptions/app.exception'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService } from './scheduling.service'

const version = (status: ScheduleVersionStatus) => ({
  id: 'v1',
  tenantId: 't1',
  plantId: 'p1',
  status,
  horizonStart: new Date('2026-06-22T06:00:00Z'),
  horizonEnd: new Date('2026-06-29T06:00:00Z'),
  optimizerRunId: 'run-1',
  supersedesVersionId: null,
  createdAt: new Date('2026-06-22T05:00:00Z'),
})

/** Build the service with a fake repo (discardDraft only touches repo.findVersion + updateVersionStatus). */
function serviceFor(found: ReturnType<typeof version> | undefined) {
  const updateVersionStatus = vi.fn(async (_t: string, _id: string, patch: Record<string, unknown>) => ({ ...version('draft'), ...patch }))
  const repo = { findVersion: vi.fn(async () => found), updateVersionStatus }
  const svc = new SchedulingService(repo as never, null as never, null as never, null as never, null as never, null as never)
  return { svc, updateVersionStatus }
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

/**
 * The immutability boundary (IATF/audit) is the thing to verify hardest: ONLY a never-committed
 * `draft` may be soft-deleted. A `committed` or `superseded` (a former live plan) is permanent and
 * must reject deletion — and must NOT be mutated when it does.
 */
describe('discardDraft — draft-only boundary', () => {
  it('discards a draft (status → discarded) and returns it', async () => {
    const { svc, updateVersionStatus } = serviceFor(version('draft'))
    const dto = await svc.discardDraft('t1', 'v1')
    expect(updateVersionStatus).toHaveBeenCalledWith('t1', 'v1', { status: 'discarded' })
    expect(dto.status).toBe('discarded')
  })

  it('REJECTS a committed version (immutable) and does not mutate it', async () => {
    const { svc, updateVersionStatus } = serviceFor(version('committed'))
    expect(await codeOf(svc.discardDraft('t1', 'v1'))).toBe('SCHEDULE_VERSION_NOT_DRAFT')
    expect(updateVersionStatus).not.toHaveBeenCalled()
  })

  it('REJECTS a superseded version (former live plan — immutable) and does not mutate it', async () => {
    const { svc, updateVersionStatus } = serviceFor(version('superseded'))
    expect(await codeOf(svc.discardDraft('t1', 'v1'))).toBe('SCHEDULE_VERSION_NOT_DRAFT')
    expect(updateVersionStatus).not.toHaveBeenCalled()
  })

  it('REJECTS an already-discarded version (no longer a draft)', async () => {
    const { svc } = serviceFor(version('discarded'))
    expect(await codeOf(svc.discardDraft('t1', 'v1'))).toBe('SCHEDULE_VERSION_NOT_DRAFT')
  })

  it('404s when the version does not exist for this tenant', async () => {
    const { svc } = serviceFor(undefined)
    expect(await codeOf(svc.discardDraft('t1', 'nope'))).toBe('SCHEDULE_VERSION_NOT_FOUND')
  })
})

/**
 * Auto-reap: a new draft soft-deletes the plant's prior drafts (status → discarded) so the version
 * list stays clean. The update SETS discarded and returns the reaped count (the WHERE that scopes it
 * to draft rows + excludes the kept id is the same draft-only invariant the boundary test proves).
 */
describe('discardDraftsForPlant — auto-reap soft-deletes drafts', () => {
  it('issues a soft-delete (set discarded) and returns the reaped count', async () => {
    let setValue: unknown = null
    let whereApplied = false
    const fakeDb = {
      update: () => ({
        set: (v: unknown) => {
          setValue = v
          return {
            where: () => {
              whereApplied = true
              return { returning: async () => [{ id: 'old-1' }, { id: 'old-2' }] }
            },
          }
        },
      }),
    }
    const repo = new SchedulingRepository(fakeDb as never)
    const n = await repo.discardDraftsForPlant('t1', 'p1', 'keep-me')
    expect(n).toBe(2)
    expect(setValue).toEqual({ status: 'discarded' })
    expect(whereApplied).toBe(true)
  })
})
