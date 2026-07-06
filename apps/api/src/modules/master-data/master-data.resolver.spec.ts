import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppException } from '../../common/exceptions/app.exception'
import { MasterDataResolver } from './master-data.resolver'
import type { Part, Routing, RoutingOperation } from './schema'

/**
 * MasterDataResolver revise logic (Layer 0 §5/§6) — unit level, repo mocked. Proves the
 * effectivity validation and the audit action mapping (revise on the new version + supersede
 * on the prior), and that op rows copy forward. The transactional atomicity + window-correct
 * resolution are proven end-to-end against the DB separately.
 */

const partRow = (over: Partial<Part> = {}): Part => ({
  id: 'p_v1',
  tenantId: 't1',
  partNo: 'X-1',
  description: 'orig',
  partType: 'component',
  uom: 'EA',
  material: 'steel',
  gauge: null,
  colour: null,
  status: 'active',
  revision: 'A',
  makeBuy: 'make',
  customerPartNo: null,
  customerId: null,
  program: null,
  effectiveFrom: new Date('2026-06-01T00:00:00Z'),
  effectiveTo: null,
  supersedesId: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...over,
})

const routingRow = (over: Partial<Routing> = {}): Routing => ({
  id: 'r_v1',
  tenantId: 't1',
  partNo: 'X-1',
  name: 'primary',
  isPrimary: true,
  status: 'active',
  revision: 'A',
  effectiveFrom: new Date('2026-06-01T00:00:00Z'),
  effectiveTo: null,
  supersedesId: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...over,
})

const op = (over: Partial<RoutingOperation> = {}): RoutingOperation => ({
  id: 'op1',
  tenantId: 't1',
  routingId: 'r_v1',
  opSeq: 10,
  resourceGroupId: 'rg1',
  stdSetupTime: 30,
  stdCycleTime: 5,
  changeoverAttributeKey: 'colour',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  ...over,
})

const resolver = (repo: Partial<Record<string, ReturnType<typeof vi.fn>>>) =>
  new MasterDataResolver(repo as never)

describe('MasterDataResolver.revisePart', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds v2 (inherits unchanged, applies changes), supersedes v1, and writes revise+supersede audit', async () => {
    let tx: {
      priorId?: string
      effectiveFrom?: Date
      newVersion?: Record<string, unknown>
      auditRows?: Array<Record<string, unknown>>
    } = {}
    const repo = {
      findOpenPart: vi.fn().mockResolvedValue(partRow()),
      revisePartTx: vi.fn(async (input) => {
        tx = input
        return partRow({ id: input.newVersion.id, revision: 'B', material: 'aluminum', effectiveFrom: input.effectiveFrom, supersedesId: 'p_v1' })
      }),
    }
    const out = await resolver(repo).revisePart(
      't1',
      'X-1',
      { revision: 'B', effectiveFrom: '2026-09-01T00:00:00Z', ecnRef: 'ECN-9', changes: { material: 'aluminum' } },
      'user-1',
    )

    // new version: identity kept, changed attr applied, unchanged inherited, prior linked, open
    expect(tx.priorId).toBe('p_v1')
    expect(tx.effectiveFrom).toEqual(new Date('2026-09-01T00:00:00Z'))
    expect(tx.newVersion).toMatchObject({
      partNo: 'X-1',
      revision: 'B',
      material: 'aluminum',
      description: 'orig', // inherited
      supersedesId: 'p_v1',
      effectiveTo: null,
    })

    // audit mapping: [revise on new, supersede on prior]
    expect(tx.auditRows).toHaveLength(2)
    const [revise, supersede] = tx.auditRows!
    expect(revise).toMatchObject({
      entityType: 'part',
      businessKey: 'X-1',
      versionId: tx.newVersion!.id,
      action: 'revise',
      actor: 'user-1',
      sourceRef: 'ECN-9',
      changedFields: { material: { old: 'steel', new: 'aluminum' }, revision: { old: 'A', new: 'B' }, supersedesId: { new: 'p_v1' } },
    })
    expect(revise.effectiveFrom).toEqual(new Date('2026-09-01T00:00:00Z'))
    expect(supersede).toMatchObject({
      versionId: 'p_v1',
      action: 'supersede',
      changedFields: { effectiveTo: { old: null, new: '2026-09-01T00:00:00.000Z' } },
    })
    expect(out.revision).toBe('B')
  })

  it('rejects an effectiveFrom that is not strictly after the current open version', async () => {
    const repo = { findOpenPart: vi.fn().mockResolvedValue(partRow()), revisePartTx: vi.fn() }
    await expect(
      resolver(repo).revisePart('t1', 'X-1', { revision: 'B', effectiveFrom: '2026-06-01T00:00:00Z', ecnRef: null, changes: {} }, 'u'),
    ).rejects.toMatchObject({ code: 'INVALID_REVISION_EFFECTIVE_FROM' })
    expect(repo.revisePartTx).not.toHaveBeenCalled()
  })

  it('throws PART_NOT_FOUND when there is no open version to revise', async () => {
    const repo = { findOpenPart: vi.fn().mockResolvedValue(undefined), revisePartTx: vi.fn() }
    await expect(
      resolver(repo).revisePart('t1', 'X-9', { revision: 'B', effectiveFrom: '2026-09-01T00:00:00Z', ecnRef: null, changes: {} }, 'u'),
    ).rejects.toBeInstanceOf(AppException)
  })
})

describe('MasterDataResolver.reviseRouting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('copies the prior op rows forward when changes.operations is not supplied', async () => {
    let tx: { operations?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenRouting: vi.fn().mockResolvedValue(routingRow()),
      operationsFor: vi.fn(async (id: string) => (id === 'r_v1' ? [op({ opSeq: 10 }), op({ id: 'op2', opSeq: 20, resourceGroupId: 'rg2' })] : [])),
      reviseRoutingTx: vi.fn(async (input) => {
        tx = input
        return routingRow({ id: input.newVersion.id, revision: 'B', supersedesId: 'r_v1', effectiveFrom: input.effectiveFrom })
      }),
    }
    await resolver(repo).reviseRouting('t1', 'X-1', { revision: 'B', effectiveFrom: '2026-09-01T00:00:00Z', ecnRef: null, changes: {} }, 'user-1')

    expect(tx.operations).toHaveLength(2)
    expect(tx.operations![0]).toMatchObject({ tenantId: 't1', opSeq: 10, resourceGroupId: 'rg1' })
    expect(tx.operations![1]).toMatchObject({ opSeq: 20, resourceGroupId: 'rg2' })
    // op rows carry no routingId (the tx rebinds it to the new version)
    expect(tx.operations![0]).not.toHaveProperty('routingId')
  })
})
