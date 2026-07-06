import { UNRESOLVABLE_PART_REF } from '@perduraflow/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppException } from '../../common/exceptions/app.exception'
import { toPartDto, toPartVersionDto } from './master-data.mapper'
import { MasterDataResolver } from './master-data.resolver'
import type { Part, PartPlant, Routing, RoutingOperation } from './schema'

const partPlantRow = (over: Partial<PartPlant> = {}): PartPlant => ({
  id: 'pp1',
  tenantId: 't1',
  partNo: 'X-1',
  plantId: 'plant-A',
  makeBuy: null,
  material: null,
  gauge: null,
  colour: null,
  toolFamily: null,
  sharedAttributes: null,
  effectiveFrom: new Date('2026-06-01T00:00:00Z'),
  effectiveTo: null,
  supersedesId: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...over,
})

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
  toolFamily: null,
  sharedAttributes: null,
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
      listUomConversions: vi.fn().mockResolvedValue([]),
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

  it('copies the prior UoM factors forward (rebound to the new version) when the base uom is unchanged', async () => {
    let tx: { uomFactors?: Array<Record<string, unknown>>; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenPart: vi.fn().mockResolvedValue(partRow({ uom: 'EA' })),
      listUomConversions: vi.fn().mockResolvedValue([
        { id: 'u1', tenantId: 't1', partId: 'p_v1', alternateUom: 'BOX', baseUom: 'EA', factor: 12 },
        { id: 'u2', tenantId: 't1', partId: 'p_v1', alternateUom: 'PALLET', baseUom: 'EA', factor: 480 },
      ]),
      revisePartTx: vi.fn(async (input) => {
        tx = input
        return partRow({ id: input.newVersion.id, revision: 'B', supersedesId: 'p_v1' })
      }),
    }
    // A revise that does NOT change uom (material change only).
    await resolver(repo).revisePart('t1', 'X-1', { revision: 'B', effectiveFrom: '2026-09-01T00:00:00Z', ecnRef: null, changes: { material: 'aluminum' } }, 'u')

    expect(tx.uomFactors).toHaveLength(2)
    // Rebound to the new version id, base preserved.
    expect(tx.uomFactors![0]).toMatchObject({ tenantId: 't1', partId: tx.uomFactors![0]!.partId, alternateUom: 'BOX', baseUom: 'EA', factor: 12 })
    expect(tx.uomFactors!.every((f) => f.partId === tx.uomFactors![0]!.partId && f.partId !== 'p_v1')).toBe(true)
    // No factor-drop flag in the audit trail.
    expect(tx.auditRows![0]!.changedFields).not.toHaveProperty('uomFactors')
  })

  it('does NOT inherit UoM factors when the revise changes the base uom (guard → dropped + flagged in audit)', async () => {
    let tx: { uomFactors?: unknown[]; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenPart: vi.fn().mockResolvedValue(partRow({ uom: 'EA' })),
      listUomConversions: vi.fn().mockResolvedValue([
        { id: 'u1', tenantId: 't1', partId: 'p_v1', alternateUom: 'BOX', baseUom: 'EA', factor: 12 },
      ]),
      revisePartTx: vi.fn(async (input) => {
        tx = input
        return partRow({ id: input.newVersion.id, revision: 'B', uom: 'KG', supersedesId: 'p_v1' })
      }),
    }
    // A revise that CHANGES uom (EA → KG): the prior factors' base no longer holds.
    await resolver(repo).revisePart('t1', 'X-1', { revision: 'B', effectiveFrom: '2026-09-01T00:00:00Z', ecnRef: null, changes: { uom: 'KG' } }, 'u')

    expect(tx.uomFactors).toEqual([]) // dropped, not silently copied
    expect(tx.auditRows![0]!.changedFields).toMatchObject({ uomFactors: { old: 1, new: 0 } }) // surfaced for re-examination
  })
})

describe('MasterDataResolver UoM factor publication', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getUomFactors returns the as-of version base uom + its factor rows', async () => {
    const repo = {
      findPartAsOf: vi.fn().mockResolvedValue(partRow({ id: 'p_asof', uom: 'EA' })),
      listUomConversions: vi.fn().mockResolvedValue([
        { id: 'u1', tenantId: 't1', partId: 'p_asof', alternateUom: 'BOX', baseUom: 'EA', factor: 12 },
      ]),
    }
    const out = await resolver(repo).getUomFactors('t1', 'X-1', '2026-08-01T00:00:00Z')
    expect(out).toEqual({ baseUom: 'EA', factors: [{ alternateUom: 'BOX', factor: 12 }] })
    expect(repo.listUomConversions).toHaveBeenCalledWith('t1', 'p_asof')
  })

  it('getUomFactors returns null when no version resolves as-of', async () => {
    const repo = { findPartAsOf: vi.fn().mockResolvedValue(undefined), listUomConversions: vi.fn() }
    expect(await resolver(repo).getUomFactors('t1', 'X-9')).toBeNull()
    expect(repo.listUomConversions).not.toHaveBeenCalled()
  })

  it('addUomFactor enforces base_uom = the version uom (never the caller), upserts, and records the actor on a create audit', async () => {
    const repo = {
      findPart: vi.fn().mockResolvedValue(partRow({ id: 'p_v1', uom: 'EA' })),
      findUomConversion: vi.fn().mockResolvedValue(undefined), // no prior → create
      upsertUomConversionWithAudit: vi.fn(async (row, _audit) => ({ id: 'u1', ...row })),
    }
    await resolver(repo).addUomFactor('t1', 'p_v1', 'BOX', 12, 'user-9')
    const [row, audit] = repo.upsertUomConversionWithAudit.mock.calls[0]!
    expect(row).toEqual({ tenantId: 't1', partId: 'p_v1', alternateUom: 'BOX', baseUom: 'EA', factor: 12 })
    expect(audit).toMatchObject({ entityType: 'uom_conversion', action: 'create', actor: 'user-9', changedFields: { factor: { new: 12 } } })
  })

  it('addUomFactor labels an existing factor edit as an update audit', async () => {
    const repo = {
      findPart: vi.fn().mockResolvedValue(partRow({ id: 'p_v1', uom: 'EA' })),
      findUomConversion: vi.fn().mockResolvedValue({ id: 'u1', factor: 10 }), // prior exists → update
      upsertUomConversionWithAudit: vi.fn(async (row, _audit) => ({ id: 'u1', ...row })),
    }
    await resolver(repo).addUomFactor('t1', 'p_v1', 'BOX', 12, 'user-9')
    const [, audit] = repo.upsertUomConversionWithAudit.mock.calls[0]!
    expect(audit).toMatchObject({ entityType: 'uom_conversion', action: 'update', versionId: 'u1', changedFields: { factor: { old: 10, new: 12 } } })
  })

  it('addUomFactor rejects a non-positive factor and an alternate that equals the base', async () => {
    const repo = { findPart: vi.fn().mockResolvedValue(partRow({ id: 'p_v1', uom: 'EA' })), findUomConversion: vi.fn(), upsertUomConversionWithAudit: vi.fn() }
    await expect(resolver(repo).addUomFactor('t1', 'p_v1', 'BOX', 0)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(resolver(repo).addUomFactor('t1', 'p_v1', 'EA', 2)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(repo.upsertUomConversionWithAudit).not.toHaveBeenCalled()
  })
})

describe('MasterDataResolver.resolvePart — per-plant override layering (§4E)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('without plantId is byte-identical to the pure-global mapping and never touches part_plant (inertness)', async () => {
    const global = partRow({ material: 'steel', gauge: '1.5', colour: 'red' })
    const repo = {
      findPartAsOf: vi.fn().mockResolvedValue(global),
      findPartPlantAsOf: vi.fn(),
    }
    const out = await resolver(repo).resolvePart('t1', 'X-1', { asOf: '2026-08-01T00:00:00Z' })
    // exact same object the pre-Commit-4 path produced
    expect(out).toEqual(toPartVersionDto(global))
    // the override table is not even consulted when no plant scope is given
    expect(repo.findPartPlantAsOf).not.toHaveBeenCalled()
  })

  it('with plantId, a non-null override wins on a named field (material); a null override column inherits the global', async () => {
    const global = partRow({ material: 'steel', gauge: '1.5', colour: 'red' })
    const repo = {
      findPartAsOf: vi.fn().mockResolvedValue(global),
      // override sets material, leaves gauge/colour null (inherit)
      findPartPlantAsOf: vi.fn().mockResolvedValue(partPlantRow({ material: 'aluminum' })),
    }
    const out = await resolver(repo).resolvePart('t1', 'X-1', { plantId: 'plant-A' })
    expect(out!.material).toBe('aluminum') // override wins
    expect(out!.gauge).toBe('1.5') // null override → inherit global
    expect(out!.colour).toBe('red') // null override → inherit global
    expect(repo.findPartPlantAsOf).toHaveBeenCalledWith('t1', 'X-1', 'plant-A', expect.any(Date))
  })

  it('with plantId but no override window, returns the pure global', async () => {
    const global = partRow({ material: 'steel' })
    const repo = { findPartAsOf: vi.fn().mockResolvedValue(global), findPartPlantAsOf: vi.fn().mockResolvedValue(undefined) }
    const out = await resolver(repo).resolvePart('t1', 'X-1', { plantId: 'plant-A' })
    expect(out).toEqual(toPartVersionDto(global))
  })

  it('shared_attributes shallow key-merges: plant key overrides, global-only key retained, plant null inherits, nested replaces wholesale', () => {
    const merge = (g: Record<string, unknown> | null, p: Record<string, unknown> | null) =>
      (resolver({}) as unknown as { mergeSharedAttributes: (a: typeof g, b: typeof p) => unknown }).mergeSharedAttributes(g, p)

    const global = { coating: 'zinc', hardness: 60, spec: { rev: 'A', torque: 10 } }
    const plant = { coating: 'nickel', tempering: true, hardness: null, spec: { rev: 'B' } }
    expect(merge(global, plant)).toEqual({
      coating: 'nickel', // plant overrides
      hardness: 60, // plant null → inherit global (not deleted)
      tempering: true, // plant-only key added
      spec: { rev: 'B' }, // nested object replaced wholesale (no deep merge)
    })
    // a null plant map inherits the global map wholesale
    expect(merge(global, null)).toBe(global)
    // global null + plant adds keys
    expect(merge(null, { a: 1 })).toEqual({ a: 1 })
  })
})

describe('MasterDataResolver.revisePartPlant — write path (§4E)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a fresh override (no prior open window) writes a create audit and no supersede/close', async () => {
    let tx: { priorId?: string; newRow?: Record<string, unknown>; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenPartPlant: vi.fn().mockResolvedValue(undefined),
      revisePartPlantTx: vi.fn(async (input) => {
        tx = input
        return partPlantRow({ id: input.newRow.id, material: input.newRow.material })
      }),
    }
    await resolver(repo).revisePartPlant('t1', 'X-1', 'plant-A', { effectiveFrom: '2026-09-01T00:00:00Z', changes: { material: 'aluminum' } }, 'user-1')
    expect(tx.priorId).toBeUndefined() // fresh create — nothing to close
    expect(tx.newRow).toMatchObject({ partNo: 'X-1', plantId: 'plant-A', material: 'aluminum', supersedesId: null })
    expect(tx.auditRows).toHaveLength(1)
    expect(tx.auditRows![0]).toMatchObject({ entityType: 'part_plant', action: 'create', changedFields: { plantId: { new: 'plant-A' }, material: { new: 'aluminum' } } })
  })

  it('revising an existing open override closes it and writes revise+supersede audit', async () => {
    let tx: { priorId?: string; auditRows?: Array<Record<string, unknown>> } = {}
    const repo = {
      findOpenPartPlant: vi.fn().mockResolvedValue(partPlantRow({ id: 'pp_prior', material: 'steel' })),
      revisePartPlantTx: vi.fn(async (input) => {
        tx = input
        return partPlantRow({ id: input.newRow.id })
      }),
    }
    await resolver(repo).revisePartPlant('t1', 'X-1', 'plant-A', { effectiveFrom: '2026-09-01T00:00:00Z', changes: { material: 'aluminum' } }, 'user-1')
    expect(tx.priorId).toBe('pp_prior')
    expect(tx.auditRows).toHaveLength(2)
    expect(tx.auditRows![0]).toMatchObject({ entityType: 'part_plant', action: 'revise' })
    expect(tx.auditRows![1]).toMatchObject({ entityType: 'part_plant', action: 'supersede', versionId: 'pp_prior' })
  })
})

describe('toPartDto — 1.5 part-core shape + uomFactors shaping (decision B)', () => {
  it('carries the §4A/§4C part-core fields and leaves uomFactors UNSET (never inlined in reads)', () => {
    const dto = toPartDto(partRow({ makeBuy: 'buy', customerPartNo: 'CPN-1', customerId: 'cust-1', program: 'PGM', toolFamily: 'TF-A', sharedAttributes: { coating: 'zinc' } }))
    expect(dto).toMatchObject({
      makeBuy: 'buy',
      customerPartNo: 'CPN-1',
      customerId: 'cust-1',
      program: 'PGM',
      toolFamily: 'TF-A',
      sharedAttributes: { coating: 'zinc' },
    })
    // shaping decision B: factors are published only via getUomFactors, never inlined in the DTO
    expect(dto.uomFactors).toBeUndefined()
    expect('uomFactors' in dto).toBe(false)
  })
})

describe('MasterDataResolver — MD9 part-reference resolution (§4D)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolvePlantPart returns the global partNo when a mapping window covers as-of', async () => {
    const repo = {
      findPlantPartMappingAsOf: vi.fn().mockResolvedValue({ partNo: 'RAM-2001', plantId: 'plant-A', plantPartNo: 'LOCAL-7' }),
    }
    const out = await resolver(repo).resolvePlantPart('t1', 'plant-A', 'LOCAL-7', '2026-08-01T00:00:00Z')
    expect(out).toEqual({ partNo: 'RAM-2001' })
    expect(repo.findPlantPartMappingAsOf).toHaveBeenCalledWith('t1', 'plant-A', 'LOCAL-7', expect.any(Date))
  })

  it('resolvePlantPart returns the TYPED UNRESOLVABLE_PART_REF (not null / not a guess) when nothing maps', async () => {
    const repo = { findPlantPartMappingAsOf: vi.fn().mockResolvedValue(undefined) }
    const out = await resolver(repo).resolvePlantPart('t1', 'plant-A', 'NOPE')
    expect(out).toBe(UNRESOLVABLE_PART_REF)
    expect(out).not.toBeNull()
  })

  it('resolveCustomerPart resolves via the inline customer_id/customer_part_no part fields as-of', async () => {
    const repo = {
      findPartByCustomerRefAsOf: vi.fn().mockResolvedValue(partRow({ partNo: 'RAM-2002', customerId: 'cust-1', customerPartNo: 'CPN-9' })),
    }
    const out = await resolver(repo).resolveCustomerPart('t1', 'cust-1', 'CPN-9')
    expect(out).toEqual({ partNo: 'RAM-2002' })
    expect(repo.findPartByCustomerRefAsOf).toHaveBeenCalledWith('t1', 'cust-1', 'CPN-9', expect.any(Date))
  })

  it('resolveCustomerPart returns the typed UNRESOLVABLE_PART_REF when no part bears the customer ref', async () => {
    const repo = { findPartByCustomerRefAsOf: vi.fn().mockResolvedValue(undefined) }
    expect(await resolver(repo).resolveCustomerPart('t1', 'cust-1', 'NOPE')).toBe(UNRESOLVABLE_PART_REF)
  })

  it('revisePlantPartMapping: a fresh mapping writes a create audit; an existing one revises+supersedes', async () => {
    let tx: { priorId?: string; auditRows?: Array<Record<string, unknown>> } = {}
    const create = {
      findOpenPlantPartMapping: vi.fn().mockResolvedValue(undefined),
      revisePlantPartMappingTx: vi.fn(async (input) => {
        tx = input
        return { id: input.newRow.id, ...input.newRow }
      }),
    }
    await resolver(create).revisePlantPartMapping('t1', 'plant-A', 'LOCAL-7', { partNo: 'RAM-2001' }, 'user-1')
    expect(tx.priorId).toBeUndefined()
    expect(tx.auditRows).toHaveLength(1)
    expect(tx.auditRows![0]).toMatchObject({ entityType: 'plant_part_mapping', action: 'create', changedFields: { partNo: { new: 'RAM-2001' } } })

    const revise = {
      findOpenPlantPartMapping: vi.fn().mockResolvedValue({ id: 'ppm_prior', partNo: 'RAM-2001', plantId: 'plant-A', plantPartNo: 'LOCAL-7', effectiveFrom: new Date('2026-06-01T00:00:00Z') }),
      revisePlantPartMappingTx: vi.fn(async (input) => {
        tx = input
        return { id: input.newRow.id, ...input.newRow }
      }),
    }
    await resolver(revise).revisePlantPartMapping('t1', 'plant-A', 'LOCAL-7', { partNo: 'RAM-2099', effectiveFrom: '2026-09-01T00:00:00Z' }, 'user-1')
    expect(tx.priorId).toBe('ppm_prior')
    expect(tx.auditRows).toHaveLength(2)
    expect(tx.auditRows![0]).toMatchObject({ action: 'revise', changedFields: { partNo: { old: 'RAM-2001', new: 'RAM-2099' } } })
    expect(tx.auditRows![1]).toMatchObject({ action: 'supersede', versionId: 'ppm_prior' })
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
