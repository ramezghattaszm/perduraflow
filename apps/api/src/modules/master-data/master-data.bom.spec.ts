import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppException } from '../../common/exceptions/app.exception'
import { MasterDataResolver } from './master-data.resolver'
import type { Bom } from './schema'

/**
 * BOM draft/publish logic (Layer 2 §4a.2, D-L2-2) — unit level, repo mocked. Proves draft authoring
 * (create vs update = the one-open-draft upsert), the publish transition (open window + supersede prior +
 * audit), and that a draft is invisible to resolve-as-of. Transactional atomicity + the DB invariants
 * (partial uniques, GiST) are proven end-to-end against the DB separately.
 */

const bomRow = (over: Partial<Bom> = {}): Bom => ({
  id: 'b_v1',
  tenantId: 't1',
  parentPartNo: 'FG-1',
  revision: 'A',
  status: 'draft',
  effectiveFrom: null,
  effectiveTo: null,
  supersedesId: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...over,
})
const resolver = (repo: Partial<Record<string, ReturnType<typeof vi.fn>>>) => new MasterDataResolver(repo as never)
const COMPS = [{ componentPartNo: 'C-1', qtyPer: '2' }, { componentPartNo: 'C-2', qtyPer: '0.5', scrapPct: '0.05' }]

describe('MasterDataResolver.reviseBom — draft authoring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the first draft (status draft, no window, edges + create audit)', async () => {
    let tx: { draftId?: string; header?: Record<string, unknown>; components?: unknown[]; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenDraftBom: vi.fn().mockResolvedValue(undefined),
      reviseBomTx: vi.fn(async (input) => { tx = input; return bomRow({ id: input.header.id }) }),
    }
    await resolver(repo).reviseBom('t1', 'FG-1', { components: COMPS }, 'user-1')
    expect(tx.draftId).toBeUndefined() // fresh insert, not an update
    expect(tx.header).toMatchObject({ parentPartNo: 'FG-1', status: 'draft', effectiveFrom: null })
    expect(tx.components).toHaveLength(2)
    expect(tx.components![0]).toMatchObject({ componentPartNo: 'C-1', qtyPer: '2', scrapPct: null })
    expect(tx.components![1]).toMatchObject({ componentPartNo: 'C-2', qtyPer: '0.5', scrapPct: '0.05' })
    expect(tx.auditRows![0]).toMatchObject({ entityType: 'bom', action: 'create', businessKey: 'FG-1' })
  })

  it('updates the existing draft in place (one-open-draft upsert — no second row), update audit', async () => {
    let tx: { draftId?: string; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenDraftBom: vi.fn().mockResolvedValue(bomRow({ id: 'b_draft', revision: 'A' })),
      reviseBomTx: vi.fn(async (input) => { tx = input; return bomRow({ id: 'b_draft' }) }),
    }
    await resolver(repo).reviseBom('t1', 'FG-1', { revision: 'B', components: COMPS }, 'user-1')
    expect(tx.draftId).toBe('b_draft') // replaces the existing draft
    expect(tx.auditRows![0]).toMatchObject({ entityType: 'bom', action: 'update', versionId: 'b_draft' })
  })
})

describe('MasterDataResolver.publishBom — draft → published', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes the draft with an open window; no prior → single revise audit, no supersede', async () => {
    let tx: { draftId?: string; priorPublishedId?: string; effectiveFrom?: Date; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenDraftBom: vi.fn().mockResolvedValue(bomRow({ id: 'b_draft' })),
      findOpenPublishedBom: vi.fn().mockResolvedValue(undefined),
      bomComponentsFor: vi.fn().mockResolvedValue([]), // integrity gate: no edges → valid
      publishBomTx: vi.fn(async (input) => { tx = input; return bomRow({ id: input.draftId, status: 'published', effectiveFrom: input.effectiveFrom }) }),
    }
    const out = await resolver(repo).publishBom('t1', 'FG-1', '2026-09-01T00:00:00Z', 'user-1')
    expect(tx.priorPublishedId).toBeUndefined()
    expect(tx.effectiveFrom).toEqual(new Date('2026-09-01T00:00:00Z'))
    expect(tx.auditRows).toHaveLength(1)
    expect(tx.auditRows![0]).toMatchObject({ entityType: 'bom', versionId: 'b_draft', action: 'revise', changedFields: { status: { old: 'draft', new: 'published' } } })
    expect(out.status).toBe('published')
  })

  it('supersedes the prior open published (revise + supersede audit) and links supersedes_id', async () => {
    let tx: { priorPublishedId?: string; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenDraftBom: vi.fn().mockResolvedValue(bomRow({ id: 'b_draft' })),
      findOpenPublishedBom: vi.fn().mockResolvedValue(bomRow({ id: 'b_prior', status: 'published', effectiveFrom: new Date('2026-06-01T00:00:00Z') })),
      bomComponentsFor: vi.fn().mockResolvedValue([]), // integrity gate: no edges → valid
      publishBomTx: vi.fn(async (input) => { tx = input; return bomRow({ id: input.draftId, status: 'published', supersedesId: input.priorPublishedId }) }),
    }
    await resolver(repo).publishBom('t1', 'FG-1', '2026-09-01T00:00:00Z', 'user-1')
    expect(tx.priorPublishedId).toBe('b_prior')
    expect(tx.auditRows).toHaveLength(2)
    const [revise, supersede] = tx.auditRows!
    expect(revise).toMatchObject({ versionId: 'b_draft', action: 'revise', changedFields: { supersedesId: { new: 'b_prior' } } })
    expect(supersede).toMatchObject({ versionId: 'b_prior', action: 'supersede', changedFields: { status: { old: 'published', new: 'superseded' } } })
  })

  it('rejects publishing when there is no open draft (BOM_NOT_FOUND)', async () => {
    const repo = { findOpenDraftBom: vi.fn().mockResolvedValue(undefined), publishBomTx: vi.fn() }
    await expect(resolver(repo).publishBom('t1', 'FG-9', '2026-09-01T00:00:00Z', 'u')).rejects.toMatchObject({ code: 'BOM_NOT_FOUND' })
    expect(repo.publishBomTx).not.toHaveBeenCalled()
  })

  it('rejects an effectiveFrom not strictly after the prior published version', async () => {
    const repo = {
      findOpenDraftBom: vi.fn().mockResolvedValue(bomRow({ id: 'b_draft' })),
      findOpenPublishedBom: vi.fn().mockResolvedValue(bomRow({ id: 'b_prior', status: 'published', effectiveFrom: new Date('2026-09-01T00:00:00Z') })),
      publishBomTx: vi.fn(),
    }
    await expect(resolver(repo).publishBom('t1', 'FG-1', '2026-09-01T00:00:00Z', 'u')).rejects.toMatchObject({ code: 'INVALID_REVISION_EFFECTIVE_FROM' })
    expect(repo.publishBomTx).not.toHaveBeenCalled()
  })
})

describe('MasterDataResolver.resolveBom — drafts invisible to resolve-as-of', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the published version + edges when one is effective as-of', async () => {
    const repo = {
      findBomAsOf: vi.fn().mockResolvedValue(bomRow({ id: 'b_pub', status: 'published', effectiveFrom: new Date('2026-06-01T00:00:00Z') })),
      bomComponentsFor: vi.fn().mockResolvedValue([{ id: 'e1', componentPartNo: 'C-1', qtyPer: '2' }]),
    }
    const out = await resolver(repo).resolveBom('t1', 'FG-1', '2026-08-01T00:00:00Z')
    expect(out!.bom.id).toBe('b_pub')
    expect(out!.components).toHaveLength(1)
    expect(repo.findBomAsOf).toHaveBeenCalledWith('t1', 'FG-1', new Date('2026-08-01T00:00:00Z'))
  })

  it('returns null when only a draft exists (findBomAsOf filters to published — a draft never resolves)', async () => {
    const repo = { findBomAsOf: vi.fn().mockResolvedValue(undefined), bomComponentsFor: vi.fn() }
    expect(await resolver(repo).resolveBom('t1', 'FG-1')).toBeNull()
    expect(repo.bomComponentsFor).not.toHaveBeenCalled()
  })
})
