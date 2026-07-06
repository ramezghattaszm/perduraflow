import { HttpStatus, Injectable } from '@nestjs/common'
import type {
  PartVersionDto,
  ReviseRoutingRequest,
  RevisePartRequest,
  RoutingVersionDto,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { generateId } from '../../db/ulid'
import { toPartVersionDto, toRoutingVersionDto } from './master-data.mapper'
import { MasterDataRepository } from './master-data.repository'
import type {
  MasterDataAuditChange,
  NewMasterDataAudit,
  NewPart,
  NewRouting,
  NewRoutingOperation,
  Part,
  Routing,
} from './schema'

/** Part attributes carried across revisions (identity `part_no` excluded). Includes the Layer 1 §4A engineering fields. */
const PART_ATTR_COLS = [
  'description',
  'partType',
  'uom',
  'material',
  'gauge',
  'colour',
  'status',
  'makeBuy',
  'customerPartNo',
  'customerId',
  'program',
] as const
/** Routing header attributes carried across revisions (operations audited via the version's op rows). */
const ROUTING_ATTR_COLS = ['name', 'isPrimary', 'status'] as const

/**
 * Resolve-as-of + revise for the Pattern-A versioned entities (`part`, `routing`) — Layer 0 §5 / MD3.
 * Resolution follows the durable business key (`part_no`, `(part_no, name)`) at a point in time; a
 * revise is one transaction (close prior window → open new version → write audit). The scoped-DB
 * transaction lives in the repository (O2); this service owns the domain logic — window selection,
 * effectivity validation, and the audit-row shape.
 *
 * Window is half-open **`[effective_from, effective_to)`** — `effective_from <= asOf AND (effective_to
 * IS NULL OR effective_to > asOf)` — matching the GiST exclusion constraint's `tstzrange`.
 *
 * `revise*` is **native-SoR only** (no external-connector guard needed until a connector exists) and
 * must be called behind `configure`/master-data-admin authorization when exposed over transport.
 */
@Injectable()
export class MasterDataResolver {
  constructor(private readonly repo: MasterDataRepository) {}

  // --- resolve-as-of ---------------------------------------------------------
  /** The part version effective at `asOf` (default now) for `partNo`, or null. */
  async resolvePart(tenantId: string, partNo: string, asOf?: string): Promise<PartVersionDto | null> {
    const at = asOf ? new Date(asOf) : new Date()
    const row = await this.repo.findPartAsOf(tenantId, partNo, at)
    return row ? toPartVersionDto(row) : null
  }

  /** Full revision history for `partNo`, oldest first. */
  async resolvePartVersions(tenantId: string, partNo: string): Promise<PartVersionDto[]> {
    return (await this.repo.listPartVersions(tenantId, partNo)).map(toPartVersionDto)
  }

  /** Reads one EXACT part version by row id (a frozen-snapshot read: `scheduled_operation.part_id`), or null. Non-deprecated. */
  async getPartVersion(tenantId: string, versionId: string): Promise<PartVersionDto | null> {
    const row = await this.repo.findPart(tenantId, versionId)
    return row ? toPartVersionDto(row) : null
  }

  /** The routing version effective at `asOf` (default now) for `partNo` (with operations), or null. */
  async resolveRouting(
    tenantId: string,
    partNo: string,
    opts: { name?: string; primaryOnly?: boolean; asOf?: string } = {},
  ): Promise<RoutingVersionDto | null> {
    const at = opts.asOf ? new Date(opts.asOf) : new Date()
    const row = await this.repo.findRoutingAsOf(tenantId, partNo, {
      name: opts.name,
      primaryOnly: opts.primaryOnly,
      asOf: at,
    })
    if (!row) return null
    return toRoutingVersionDto(row, await this.repo.operationsFor(row.id))
  }

  // --- revise (transactional: close prior → open new → audit) ----------------
  /**
   * Creates a new part revision. Transactional in the repository.
   * @throws AppException PART_NOT_FOUND - no open version of `partNo` to revise
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - `effectiveFrom` not strictly after the open version's
   */
  async revisePart(tenantId: string, partNo: string, input: RevisePartRequest, actor: string): Promise<PartVersionDto> {
    const prior = await this.repo.findOpenPart(tenantId, partNo)
    if (!prior) throw new AppException(HttpStatus.NOT_FOUND, 'No open part version to revise', ERROR_CODES.PART_NOT_FOUND)
    const effectiveFrom = this.assertAfter(input.effectiveFrom, prior.effectiveFrom)

    const c = input.changes
    const newVersion: NewPart = {
      id: generateId(),
      tenantId,
      partNo,
      description: c.description !== undefined ? c.description : prior.description,
      partType: c.partType ?? prior.partType,
      uom: c.uom ?? prior.uom,
      material: c.material !== undefined ? c.material : prior.material,
      gauge: c.gauge !== undefined ? c.gauge : prior.gauge,
      colour: c.colour !== undefined ? c.colour : prior.colour,
      status: c.status ?? prior.status,
      // Layer 1 §4A engineering fields — copied forward from the prior version unless the revise changes them.
      makeBuy: c.makeBuy ?? prior.makeBuy,
      customerPartNo: c.customerPartNo !== undefined ? c.customerPartNo : prior.customerPartNo,
      customerId: c.customerId !== undefined ? c.customerId : prior.customerId,
      program: c.program !== undefined ? c.program : prior.program,
      revision: input.revision,
      effectiveFrom,
      effectiveTo: null,
      supersedesId: prior.id,
    }
    const changedFields = this.diffAttrs(prior, newVersion, PART_ATTR_COLS)
    changedFields['revision'] = { old: prior.revision, new: input.revision }
    changedFields['supersedesId'] = { new: prior.id }

    const auditRows = this.reviseAuditRows({
      tenantId,
      entityType: 'part',
      businessKey: partNo,
      newId: newVersion.id!,
      priorId: prior.id,
      priorEffectiveFrom: prior.effectiveFrom,
      effectiveFrom,
      actor,
      sourceRef: input.ecnRef,
      changedFields,
    })

    const newRow = await this.repo.revisePartTx({ tenantId, priorId: prior.id, effectiveFrom, newVersion, auditRows })
    return toPartVersionDto(newRow)
  }

  /**
   * Creates a new routing revision (copies the prior op rows onto the new version, unless `changes.operations`
   * replaces them). Transactional in the repository.
   * @throws AppException ROUTING_NOT_FOUND - no open routing to revise for `partNo`
   * @throws AppException INVALID_REVISION_EFFECTIVE_FROM - `effectiveFrom` not strictly after the open version's
   */
  async reviseRouting(tenantId: string, partNo: string, input: ReviseRoutingRequest, actor: string): Promise<RoutingVersionDto> {
    const select = input.name ? { name: input.name } : { primaryOnly: true }
    const prior = await this.repo.findOpenRouting(tenantId, partNo, select)
    if (!prior) throw new AppException(HttpStatus.NOT_FOUND, 'No open routing to revise', ERROR_CODES.ROUTING_NOT_FOUND)
    const effectiveFrom = this.assertAfter(input.effectiveFrom, prior.effectiveFrom)

    const c = input.changes
    const newVersion: NewRouting = {
      id: generateId(),
      tenantId,
      partNo,
      name: c.name ?? prior.name,
      isPrimary: c.isPrimary ?? prior.isPrimary,
      status: c.status ?? prior.status,
      revision: input.revision,
      effectiveFrom,
      effectiveTo: null,
      supersedesId: prior.id,
    }

    // Operations: replace with the supplied set, or copy the prior version's rows forward.
    const sourceOps = c.operations
      ? c.operations
      : (await this.repo.operationsFor(prior.id)).map((o) => ({
          opSeq: o.opSeq,
          resourceGroupId: o.resourceGroupId,
          stdSetupTime: o.stdSetupTime,
          stdCycleTime: o.stdCycleTime,
          changeoverAttributeKey: o.changeoverAttributeKey,
        }))
    const operations: Omit<NewRoutingOperation, 'routingId'>[] = sourceOps.map((o) => ({
      tenantId,
      opSeq: o.opSeq,
      resourceGroupId: o.resourceGroupId,
      stdSetupTime: o.stdSetupTime,
      stdCycleTime: o.stdCycleTime,
      changeoverAttributeKey: o.changeoverAttributeKey ?? null,
    }))

    const changedFields = this.diffAttrs(prior, newVersion, ROUTING_ATTR_COLS)
    changedFields['revision'] = { old: prior.revision, new: input.revision }
    changedFields['supersedesId'] = { new: prior.id }
    if (c.operations) changedFields['operations'] = { new: operations.length }

    const auditRows = this.reviseAuditRows({
      tenantId,
      entityType: 'routing',
      businessKey: partNo,
      newId: newVersion.id!,
      priorId: prior.id,
      priorEffectiveFrom: prior.effectiveFrom,
      effectiveFrom,
      actor,
      sourceRef: input.ecnRef,
      changedFields,
    })

    const newRow = await this.repo.reviseRoutingTx({ tenantId, priorId: prior.id, effectiveFrom, newVersion, operations, auditRows })
    return toRoutingVersionDto(newRow, await this.repo.operationsFor(newRow.id))
  }

  // --- internals -------------------------------------------------------------
  /** Parse + validate: the new window must open strictly after the current open version's start. */
  private assertAfter(effectiveFromIso: string, priorEffectiveFrom: Date): Date {
    const effectiveFrom = new Date(effectiveFromIso)
    if (!(effectiveFrom.getTime() > priorEffectiveFrom.getTime())) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "A revision's effective_from must be strictly after the current version's",
        ERROR_CODES.INVALID_REVISION_EFFECTIVE_FROM,
      )
    }
    return effectiveFrom
  }

  /** Old→new for the tracked columns that actually changed; unchanged columns omitted. */
  private diffAttrs(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    cols: readonly string[],
  ): Record<string, MasterDataAuditChange> {
    const out: Record<string, MasterDataAuditChange> = {}
    for (const col of cols) {
      const old = before[col] ?? null
      const next = after[col] ?? null
      if (old !== next) out[col] = { old, new: next }
    }
    return out
  }

  /**
   * The two audit rows a revise writes (Layer 0 §6 mapping): `revise` on the NEW version (the changed
   * attributes + revision/supersedesId, stamped with the new window start) and `supersede` on the PRIOR
   * version (its window was closed at `effectiveFrom`). Both carry the ECN/ECR `sourceRef`.
   */
  private reviseAuditRows(p: {
    tenantId: string
    entityType: 'part' | 'routing'
    businessKey: string
    newId: string
    priorId: string
    priorEffectiveFrom: Date
    effectiveFrom: Date
    actor: string
    sourceRef: string | null
    changedFields: Record<string, MasterDataAuditChange>
  }): NewMasterDataAudit[] {
    return [
      {
        tenantId: p.tenantId,
        entityType: p.entityType,
        businessKey: p.businessKey,
        versionId: p.newId,
        action: 'revise',
        actor: p.actor,
        sourceRef: p.sourceRef,
        effectiveFrom: p.effectiveFrom,
        changedFields: p.changedFields,
      },
      {
        tenantId: p.tenantId,
        entityType: p.entityType,
        businessKey: p.businessKey,
        versionId: p.priorId,
        action: 'supersede',
        actor: p.actor,
        sourceRef: p.sourceRef,
        effectiveFrom: p.priorEffectiveFrom,
        changedFields: { effectiveTo: { old: null, new: p.effectiveFrom.toISOString() } },
      },
    ]
  }
}
