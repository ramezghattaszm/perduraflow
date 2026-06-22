import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import {
  MASTERDATA_READ_CONTRACT,
  type ExecutionActualPayload,
  type MasterDataReadContract,
  type RoutingOperationDto,
  type SimulateActualsRequest,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { EVENTS } from '../../events'
import { BindingResolver } from '../binding/binding.resolver'
import { EventBus } from '../eventbus/event-bus'
import { toDemandInputDto } from './scheduling.mapper'
import { SchedulingRepository } from './scheduling.repository'

/**
 * Execution-actuals **simulator** (SKIP-51) — a clearly-separated **demo fixture**
 * (dev/staging only, never in nav). Reads a committed schedule version's operations
 * (own module) and emits 4.3-shaped actuals on the EventBus (`execution.actual.
 * recorded`), which `learning` consumes. **Seeded/deterministic** (D2): noise is a
 * pure hash of `(versionId, opId, cycle)`. Default = near-standard noise; the
 * `drift` trigger ramps a chosen resource's cycle to `+magnitude` (the Collision-2
 * tool-wear). Cleanly swappable for a real MES connector behind the same event.
 */
@Injectable()
export class SimulatorService {
  private readonly NOISE = 0.005 // ±0.5% near-standard variation — tight enough that a gentle, real wear
  // trend reads cleanly above the noise floor (so a deterministic days-out prediction emerges), and
  // pure-noise series on non-drifting params stay below the trend threshold (no spurious predictions).
  private readonly YIELD = 0.97 // baseline good-quantity fraction

  constructor(
    private readonly repo: SchedulingRepository,
    private readonly bindings: BindingResolver,
    private readonly events: EventBus,
  ) {}

  private resolveMasterData(tenantId: string): Promise<MasterDataReadContract> {
    return this.bindings.resolve<MasterDataReadContract>(tenantId, MASTERDATA_READ_CONTRACT)
  }

  /**
   * Dev scenario launcher — persistently change an active demand line's quantity (a
   * real demand revision). Mutates `demand_input`, so a subsequent solve reflects it.
   * @throws NO_DEMAND_TO_SCHEDULE - no active demand line with that id for the tenant
   */
  async updateDemandQty(tenantId: string, demandLineId: string, requiredQty: number) {
    const row = await this.repo.updateDemandQty(tenantId, demandLineId, requiredQty)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, `Unknown active demand line ${demandLineId}`, ERROR_CODES.NO_DEMAND_TO_SCHEDULE)
    return toDemandInputDto(row)
  }

  /**
   * Dev scenario launcher — set a buy-component's availability date (the §4.8 material gate
   * input). Mutates `material_availability` only (no solve/commit); the board detects the
   * gated condition and a re-solve reflects it. Reset = set an early time (on-hand).
   */
  async setMaterialAvailability(tenantId: string, plantId: string, componentPartId: string, availableAt: Date) {
    const row = await this.repo.setMaterialAvailability(tenantId, plantId, componentPartId, availableAt)
    return { componentPartId, availableAt: (row?.availableAt ?? availableAt).toISOString() }
  }

  /**
   * Dev scenario launcher — pin (or swap) the operator running a line (the §4.8 performance
   * input, C5). Mutates `resource_operator_assignment` only (no solve); a re-solve then reflects
   * the new operator's `performanceFactor` on that line's run time. The factor itself is set via
   * the master-data operator update (it lives on the operator, not the assignment).
   */
  async setResourceOperatorAssignment(
    tenantId: string,
    plantId: string,
    resourceId: string,
    operatorId: string,
    effectiveFrom: Date | null,
    effectiveTo: Date | null,
  ) {
    const row = await this.repo.setResourceOperatorAssignment(tenantId, plantId, resourceId, operatorId, effectiveFrom, effectiveTo)
    return { resourceId, operatorId: row?.operatorId ?? operatorId }
  }

  /**
   * Emit `cyclesPerOp` deterministic actuals for every op of a committed version.
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND / SCHEDULE_VERSION_NOT_COMMITTED
   */
  async simulate(tenantId: string, req: SimulateActualsRequest): Promise<{ emitted: number }> {
    const version = await this.repo.findVersion(tenantId, req.scheduleVersionId)
    if (!version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    if (version.status !== 'committed') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'Simulator requires a committed version',
        ERROR_CODES.SCHEDULE_VERSION_NOT_COMMITTED,
      )
    }
    const ops = await this.repo.operationsForVersion(version.id)
    const md = await this.resolveMasterData(tenantId)

    // Resolve the D7 std baselines per op (carried on the actual so the learner is self-contained).
    const stdCache = new Map<string, RoutingOperationDto | undefined>()
    const stdFor = async (partId: string, routingOperationId: string): Promise<RoutingOperationDto | undefined> => {
      const key = `${partId}:${routingOperationId}`
      if (stdCache.has(key)) return stdCache.get(key)
      const routing = await md.getPrimaryRoutingForPart(tenantId, partId)
      const op = routing?.operations.find((o) => o.id === routingOperationId)
      stdCache.set(key, op)
      return op
    }

    let seq = 0
    let emitted = 0
    // Per-resource running cycle index → the drift ramp builds across the resource's cycles in
    // emission (chronological) order, so wear accrues day-over-day across past ops — not reset
    // inside each op. (Ops come back ordered by sequence position.)
    const resCycleIdx = new Map<string, number>()
    for (const op of ops) {
      // Rolling window: only COMPLETED (past) ops execute; today/future ops stay planned.
      if (req.completedBeforeMs != null && op.plannedEnd.getTime() > req.completedBeforeMs) continue
      const std = await stdFor(op.partId, op.routingOperationId)
      const stdCycle = std?.stdCycleTime ?? op.cycleTime
      const stdSetup = std?.stdSetupTime ?? op.setupTime
      const drifting = req.drift && req.drift.resourceId === op.resourceId
      // Seed the noise on STABLE keys (demand line + op seq + cycle), NOT the version/op ULIDs which
      // are regenerated every reset — so a `demo:reset` is truly reproducible (same actuals, same
      // learned values, same prediction every time). D2 determinism.
      const noiseKey = `${op.demandLineId}:${op.opSeq}`
      for (let k = 0; k < req.cyclesPerOp; k++) {
        const ri = resCycleIdx.get(op.resourceId) ?? 0
        resCycleIdx.set(op.resourceId, ri + 1)
        const epsCycle = (seeded(`${noiseKey}:c:${k}`) - 0.5) * 2 * this.NOISE
        const epsSetup = (seeded(`${noiseKey}:s:${k}`) - 0.5) * 2 * this.NOISE
        const ramp = req.drift ? Math.pow(Math.min(1, ri / req.drift.rampOverEvents), req.drift.curve ?? 1) : 0
        const driftCycle = drifting && req.drift!.param === 'cycle' ? 1 + req.drift!.magnitude * ramp : 1
        const driftSetup = drifting && req.drift!.param === 'setup' ? 1 + req.drift!.magnitude * ramp : 1
        const actualCycle = stdCycle * (1 + epsCycle) * driftCycle
        const actualSetup = stdSetup * (1 + epsSetup) * driftSetup
        const yieldFrac = this.YIELD + (seeded(`${noiseKey}:y:${k}`) - 0.5) * 0.04
        // A slower cycle produces fewer pieces in the same window → the drifted line
        // falls behind plan (the variance beat); throughput scales by std/actual cycle.
        const throughputFrac = actualCycle > 0 ? Math.min(1, stdCycle / actualCycle) : 1
        const goodQty = Math.max(0, Math.round(op.plannedQty * yieldFrac * throughputFrac))
        const start = op.plannedStart
        const durMin = actualSetup + actualCycle * op.plannedQty
        const payload: ExecutionActualPayload = {
          actualEventId: `${version.id}:${op.id}:${k}`,
          scheduleVersionId: version.id,
          scheduledOperationId: op.id,
          resourceId: op.resourceId,
          routingOperationId: op.routingOperationId,
          partId: op.partId,
          actualStart: start.toISOString(),
          actualEnd: new Date(start.getTime() + durMin * 60_000).toISOString(),
          actualSetupTime: actualSetup,
          actualCycleTime: actualCycle,
          stdSetupTime: stdSetup,
          stdCycleTime: stdCycle,
          goodQty,
          scrapQty: Math.max(0, op.plannedQty - goodQty),
          downtimeMinutes: Math.round(seeded(`${noiseKey}:d:${k}`) * 6),
          downtimeReason: null,
          source: 'simulator',
          seq: seq++,
        }
        await this.events.publish(EVENTS.EXECUTION_ACTUAL_RECORDED, payload, tenantId)
        emitted++
      }
    }
    return { emitted }
  }
}

/** Deterministic [0,1) hash (FNV-1a) — the simulator's seeded PRNG (D2; no randomness). */
function seeded(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}
