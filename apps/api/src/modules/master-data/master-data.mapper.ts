import type {
  CertificationDto,
  OperatorDto,
  PartDto,
  PartVersionDto,
  ResourceDowntimeDto,
  ResourceDto,
  ResourceGroupDto,
  ResourceTypeConfigDto,
  RoutingDto,
  RoutingOperationDto,
  RoutingVersionDto,
} from '@perduraflow/contracts'
import type {
  Certification,
  Operator,
  Part,
  Resource,
  ResourceDowntime,
  ResourceGroup,
  ResourceTypeConfig,
  Routing,
  RoutingOperation,
} from './schema'

/**
 * Map a part row to its `masterdata.read` DTO (`1.5` — adds the §4A/§4C part-core fields). `uomFactors`
 * is intentionally LEFT UNSET here (Commit-6 shaping decision B): factors are published only via the
 * dedicated `getUomFactors` op, never inlined in list/resolve reads, so payloads stay lean.
 */
export const toPartDto = (p: Part): PartDto => ({
  id: p.id,
  partNo: p.partNo,
  description: p.description,
  partType: p.partType,
  uom: p.uom,
  material: p.material,
  gauge: p.gauge,
  colour: p.colour,
  status: p.status,
  makeBuy: p.makeBuy,
  customerPartNo: p.customerPartNo,
  customerId: p.customerId,
  program: p.program,
  toolFamily: p.toolFamily,
  sharedAttributes: p.sharedAttributes,
})

/** Map a part row to its versioned DTO (Layer 0 `1.4`) — adds revision + effectivity window (ISO). */
export const toPartVersionDto = (p: Part): PartVersionDto => ({
  ...toPartDto(p),
  revision: p.revision,
  effectiveFrom: p.effectiveFrom.toISOString(),
  effectiveTo: p.effectiveTo ? p.effectiveTo.toISOString() : null,
})

/** Map a resource row to its DTO. */
export const toResourceDto = (r: Resource): ResourceDto => ({
  id: r.id,
  name: r.name,
  resourceType: r.resourceType,
  plantId: r.plantId,
  calendarId: r.calendarId,
  rate: r.rate,
  rateUom: r.rateUom,
  runCostPerHour: r.runCostPerHour,
  setupCost: r.setupCost,
  overheadPerUnit: r.overheadPerUnit,
  otCapMinutes: r.otCapMinutes,
  status: r.status,
})

/** Map a resource-downtime row to its DTO (`from`/`to` as ISO; line-down / maintenance closure). */
export const toResourceDowntimeDto = (d: ResourceDowntime): ResourceDowntimeDto => ({
  id: d.id,
  resourceId: d.resourceId,
  plantId: d.plantId,
  kind: d.kind,
  planned: d.planned,
  from: d.fromTs.toISOString(),
  to: d.toTs.toISOString(),
  reason: d.reason,
  isActive: d.isActive,
})

/** Map a resource-type-config row to its DTO (D-shift). */
export const toResourceTypeConfigDto = (c: ResourceTypeConfig): ResourceTypeConfigDto => ({
  resourceType: c.resourceType,
  splittable: c.splittable,
  otCapMinutes: c.otCapMinutes,
  minBatchQty: c.minBatchQty,
})

/** Map a resource-group row (+ member ids) to its DTO. */
export const toResourceGroupDto = (
  g: ResourceGroup,
  memberResourceIds: string[]
): ResourceGroupDto => ({
  id: g.id,
  name: g.name,
  plantId: g.plantId,
  memberResourceIds,
  isActive: g.isActive,
})

/** Map a routing-operation row to its DTO. */
export const toRoutingOperationDto = (o: RoutingOperation): RoutingOperationDto => ({
  id: o.id,
  opSeq: o.opSeq,
  resourceGroupId: o.resourceGroupId,
  stdSetupTime: o.stdSetupTime,
  stdCycleTime: o.stdCycleTime,
  changeoverAttributeKey: o.changeoverAttributeKey ?? null,
})

/** Map a routing row (+ its ordered operations) to its DTO. */
export const toRoutingDto = (r: Routing, operations: RoutingOperation[]): RoutingDto => ({
  id: r.id,
  partNo: r.partNo,
  name: r.name,
  isPrimary: r.isPrimary,
  status: r.status,
  operations: operations.map(toRoutingOperationDto),
})

/** Map a routing row (+ ops) to its versioned DTO (Layer 0 `1.4`) — adds revision + effectivity window. */
export const toRoutingVersionDto = (r: Routing, operations: RoutingOperation[]): RoutingVersionDto => ({
  ...toRoutingDto(r, operations),
  revision: r.revision,
  effectiveFrom: r.effectiveFrom.toISOString(),
  effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
})

/** Map a certification row to its DTO. */
export const toCertificationDto = (c: Certification): CertificationDto => ({
  id: c.id,
  code: c.code,
  name: c.name,
  description: c.description,
  isActive: c.isActive,
})

/** Map an operator row (+ held certification ids) to its DTO. */
export const toOperatorDto = (o: Operator, certificationIds: string[]): OperatorDto => ({
  id: o.id,
  name: o.name,
  homePlantId: o.homePlantId,
  laborRate: o.laborRate,
  performanceFactor: o.performanceFactor,
  available: o.available,
  absenceReason: o.absenceReason ?? null,
  certificationIds,
  isActive: o.isActive,
})
