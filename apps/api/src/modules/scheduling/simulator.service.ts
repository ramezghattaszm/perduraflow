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
  private readonly NOISE = 0.03 // ±3% near-standard variation
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
    for (const op of ops) {
      const std = await stdFor(op.partId, op.routingOperationId)
      const stdCycle = std?.stdCycleTime ?? op.cycleTime
      const stdSetup = std?.stdSetupTime ?? op.setupTime
      const drifting = req.drift && req.drift.resourceId === op.resourceId
      for (let k = 0; k < req.cyclesPerOp; k++) {
        const epsCycle = (seeded(`${version.id}:${op.id}:c:${k}`) - 0.5) * 2 * this.NOISE
        const epsSetup = (seeded(`${version.id}:${op.id}:s:${k}`) - 0.5) * 2 * this.NOISE
        const ramp = req.drift ? Math.min(1, k / req.drift.rampOverEvents) : 0
        const driftCycle = drifting && req.drift!.param === 'cycle' ? 1 + req.drift!.magnitude * ramp : 1
        const driftSetup = drifting && req.drift!.param === 'setup' ? 1 + req.drift!.magnitude * ramp : 1
        const actualCycle = stdCycle * (1 + epsCycle) * driftCycle
        const actualSetup = stdSetup * (1 + epsSetup) * driftSetup
        const yieldFrac = this.YIELD + (seeded(`${version.id}:${op.id}:y:${k}`) - 0.5) * 0.04
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
          downtimeMinutes: Math.round(seeded(`${version.id}:${op.id}:d:${k}`) * 6),
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
