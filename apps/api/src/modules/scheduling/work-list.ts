import type {
  Firmness,
  LatenessChainDto,
  OrgPriority,
  WorkListCountsDto,
  WorkListOpDto,
  WorkListRowDto,
  WorkListStatus,
} from '@perduraflow/contracts'

/**
 * Pure work-list assembly (D-worklist) — turns scheduled ops + order metadata into the all-work
 * table rows and their status rollup counts. Engine-agnostic and side-effect-free (no DB, no clock):
 * the caller passes `nowMs`, so the same inputs always yield the same rows — unit-testable in isolation.
 * Statuses are COMPUTED here, never read from a stored column (compute-not-store).
 */

/** A scheduled op reduced to the fields a work-list status derives from. */
export interface WorkListOpInput {
  demandLineId: string
  opSeq: number
  resourceId: string
  resourceName: string
  plannedStartMs: number
  plannedEndMs: number
  atRisk: boolean
  atRiskReason: string | null
  /** True when this committed op sits inside an active line-down window (can't run as planned). */
  stranded: boolean
  /** True once the op has an execution actual (it has run). */
  hasActual: boolean
  /** The op's computed causal chain (`${demandLineId}:${opSeq}`), if at-risk; else null. */
  chain: LatenessChainDto | null
}

/** Order (demand line) metadata the row carries, keyed by demandLineId. */
export interface WorkListOrderMeta {
  demandLineId: string
  partNo: string
  releaseReference: string | null
  customerName: string
  priority: OrgPriority
  firmness: Firmness
  /** ISO timestamp. */
  requiredDateIso: string
  requiredQty: number
}

/**
 * Per-op lifecycle status. Precedence (first match wins), exhaustive over committed ops:
 * `completed` (has an actual) → `at_risk` (committed, predicted late/blocked) → `stranded` (sits in
 * an active line-down window — can't run as planned) → `in_progress` (started per plan, not done) →
 * `scheduled` (future). `at_risk` uses the engine's own flag (the delivery prediction); `stranded` is
 * the separate infeasibility FACT. A stranded op isn't `atRisk`-flagged in the committed plan (it was
 * on-time pre-outage), so the two don't collide in practice — and `at_risk` wins if they ever do.
 */
export function opStatus(
  op: { hasActual: boolean; atRisk: boolean; stranded: boolean; plannedStartMs: number },
  nowMs: number
): WorkListStatus {
  if (op.hasActual) return 'completed'
  if (op.atRisk) return 'at_risk'
  if (op.stranded) return 'stranded'
  if (op.plannedStartMs <= nowMs) return 'in_progress'
  return 'scheduled'
}

/**
 * Roll an order's op statuses up to one status. Precedence: any op at-risk → `at_risk`; any op
 * stranded → `stranded`; all ops completed → `completed`; any op started (completed or in-progress)
 * → `in_progress`; else `scheduled`. An order with no ops is `scheduled`. `at_risk` outranks
 * `stranded` (a genuinely-late order is the dominant delivery signal); a not-yet-late order with an
 * infeasible op surfaces as `stranded` (re-sequence) rather than falsely on-time.
 */
export function rollupStatus(statuses: WorkListStatus[]): WorkListStatus {
  if (statuses.length === 0) return 'scheduled'
  if (statuses.includes('at_risk')) return 'at_risk'
  if (statuses.includes('stranded')) return 'stranded'
  if (statuses.every((s) => s === 'completed')) return 'completed'
  if (statuses.some((s) => s === 'completed' || s === 'in_progress')) return 'in_progress'
  return 'scheduled'
}

/** Default row order: most-actionable first — at-risk, stranded, then started, upcoming, done; due asc within. */
const STATUS_RANK: Record<WorkListStatus, number> = {
  at_risk: 0,
  stranded: 1,
  in_progress: 2,
  scheduled: 3,
  completed: 4,
}

/**
 * Assemble the work list: group ops by order, compute each op's status, roll up to an order status,
 * and tally the status counts. The at-risk binding op (lowest opSeq that's at-risk) supplies the
 * row's reason + causal chain — the same data the exception queue renders.
 */
export function buildWorkList(
  ops: WorkListOpInput[],
  orders: Map<string, WorkListOrderMeta>,
  nowMs: number
): { rows: WorkListRowDto[]; counts: WorkListCountsDto } {
  const byOrder = new Map<string, WorkListOpInput[]>()
  for (const op of ops) {
    const list = byOrder.get(op.demandLineId) ?? []
    list.push(op)
    byOrder.set(op.demandLineId, list)
  }

  const rows: WorkListRowDto[] = []
  for (const [demandLineId, list] of byOrder) {
    const meta = orders.get(demandLineId)
    if (!meta) continue // an op whose demand line we can't resolve — skip rather than fabricate metadata
    const sorted = [...list].sort(
      (a, b) => a.opSeq - b.opSeq || a.plannedStartMs - b.plannedStartMs
    )

    const opDtos: WorkListOpDto[] = sorted.map((o) => ({
      opSeq: o.opSeq,
      resourceId: o.resourceId,
      resourceName: o.resourceName,
      status: opStatus(o, nowMs),
      plannedStart: new Date(o.plannedStartMs).toISOString(),
      plannedEnd: new Date(o.plannedEndMs).toISOString(),
      atRiskReason: o.atRisk ? o.atRiskReason : null,
    }))
    const status = rollupStatus(opDtos.map((o) => o.status))

    const resourceNames: string[] = []
    for (const o of sorted)
      if (!resourceNames.includes(o.resourceName)) resourceNames.push(o.resourceName)

    const binding = status === 'at_risk' ? (sorted.find((o) => o.atRisk) ?? null) : null

    rows.push({
      id: demandLineId,
      demandLineId,
      label: `${meta.partNo} · ${meta.releaseReference ?? demandLineId}`,
      partNo: meta.partNo,
      releaseReference: meta.releaseReference,
      customerName: meta.customerName,
      priority: meta.priority,
      firmness: meta.firmness,
      requiredDate: meta.requiredDateIso,
      requiredQty: meta.requiredQty,
      status,
      plannedStart: new Date(Math.min(...sorted.map((o) => o.plannedStartMs))).toISOString(),
      plannedEnd: new Date(Math.max(...sorted.map((o) => o.plannedEndMs))).toISOString(),
      resourceNames,
      atRiskDetail: binding ? `op ${binding.opSeq} · ${binding.resourceName}` : null,
      atRiskReason: binding ? binding.atRiskReason : null,
      chain: binding ? binding.chain : null,
      ops: opDtos,
    })
  }

  rows.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.requiredDate.localeCompare(b.requiredDate) ||
      a.demandLineId.localeCompare(b.demandLineId)
  )

  const counts: WorkListCountsDto = {
    total: rows.length,
    completed: rows.filter((r) => r.status === 'completed').length,
    atRisk: rows.filter((r) => r.status === 'at_risk').length,
    stranded: rows.filter((r) => r.status === 'stranded').length,
    inProgress: rows.filter((r) => r.status === 'in_progress').length,
    scheduled: rows.filter((r) => r.status === 'scheduled').length,
  }
  return { rows, counts }
}
