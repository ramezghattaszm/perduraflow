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
  // Historical adherence misses (opt-in, `injectMisses`): a deterministic ~7.5% of past orders ran
  // off their planned window — backdated with the actual start shifted EARLIER than planned by more
  // than the 15-min adherence tolerance (duration preserved, so the actual end shifts equally and
  // on-time delivery / OEE are untouched — only Schedule Adherence drops, to low-mid 90s). Keyed on
  // the stable demand-line id, so a whole order's ops shift together and resets are byte-identical.
  // ~3% dedicated adherence-shift orders; the OTIF-miss orders also read as off-plan (their late op
  // slid), so the two together land plant adherence in the low-to-mid 90s without lockstep.
  private readonly ADH_MISS_FRAC = 0.03
  private readonly ADH_SHIFT_MS = 30 * 60_000 // 30 min > the 15-min adherence tolerance
  // Historical OTIF misses (opt-in, `injectMisses`): a deterministic ~5% of past orders DELIVERED
  // late — the order's last op slid late (start AND end shift together, run length unchanged → OEE
  // untouched) so its finish fell past the due. Keyed on the demand-line id and DISJOINT from the
  // adherence-shift set, so OTIF and Adherence are driven by different orders. Plan-independent (no
  // re-sequence): only the actual times move, so the committed plan + its live at-risk spine stand.
  private readonly OTIF_MISS_FRAC = 0.05
  private readonly OTIF_LATE_MS = 45 * 60_000 // finished this far past due

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
  async setMaterialAvailability(tenantId: string, plantId: string, componentPartNo: string, availableAt: Date) {
    const row = await this.repo.setMaterialAvailability(tenantId, plantId, componentPartNo, availableAt)
    return { componentPartNo, availableAt: (row?.availableAt ?? availableAt).toISOString() }
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

    // For OTIF misses (opt-in): the order's due + its LAST op (the delivery), so a late finish is
    // backdated onto that op's actual end only.
    const dueByLine = new Map<string, number>()
    const lastOpSeqByLine = new Map<string, number>()
    if (req.injectMisses) {
      for (const dmd of await this.repo.listDemand(tenantId, version.plantId)) {
        dueByLine.set(dmd.demandLineId, dmd.requiredDate.getTime())
      }
      for (const op of ops) {
        lastOpSeqByLine.set(op.demandLineId, Math.max(lastOpSeqByLine.get(op.demandLineId) ?? 0, op.opSeq))
      }
    }

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
    // Merge singular `drift` + multi-lane `drifts` into a per-resource lookup (last wins). One pass can
    // wear several lanes to different points; each keeps its own ramp via the per-resource resCycleIdx.
    const driftByResource = new Map<string, NonNullable<typeof req.drift>>()
    for (const d of [...(req.drift ? [req.drift] : []), ...(req.drifts ?? [])]) driftByResource.set(d.resourceId, d)
    for (const op of ops) {
      // Single-lane scope: when set, only the targeted resource emits — every other lane's history (and
      // its learned wear/prediction) is left intact. Without this, drifting one line re-emits the WHOLE
      // plant at standard and overwrites other lanes' accumulated drift (e.g. wiping a live prediction).
      if (req.onlyResourceId != null && op.resourceId !== req.onlyResourceId) continue
      // Rolling window: only COMPLETED (past) ops execute; today/future ops stay planned.
      if (req.completedBeforeMs != null && op.plannedEnd.getTime() > req.completedBeforeMs) continue
      const std = await stdFor(op.partId, op.routingOperationId)
      const stdCycle = std?.stdCycleTime ?? op.cycleTime
      const stdSetup = std?.stdSetupTime ?? op.setupTime
      const opDrift = driftByResource.get(op.resourceId)
      // Seed the noise on STABLE keys (demand line + op seq + cycle), NOT the version/op ULIDs which
      // are regenerated every reset — so a `demo:reset` is truly reproducible (same actuals, same
      // learned values, same prediction every time). D2 determinism.
      const noiseKey = `${op.demandLineId}:${op.opSeq}`
      // OTIF miss (opt-in): this order delivered late → its LAST op's actual end is pushed past the due
      // (below). Adherence miss (opt-in, DISJOINT from OTIF): this order ran off its planned window →
      // backdate the actual start earlier than planned (beyond tolerance). Both keyed per-order so an
      // order's ops move together; excluding OTIF orders from the adherence set keeps the two metrics
      // on different orders.
      const otifMiss = req.injectMisses && seeded(`${op.demandLineId}:otif`) < this.OTIF_MISS_FRAC
      const adhMiss =
        req.injectMisses && !otifMiss && seeded(`${op.demandLineId}:adh`) < this.ADH_MISS_FRAC
      const opStart = adhMiss ? new Date(op.plannedStart.getTime() - this.ADH_SHIFT_MS) : op.plannedStart
      const lateFinish = otifMiss && op.opSeq === lastOpSeqByLine.get(op.demandLineId)
      for (let k = 0; k < req.cyclesPerOp; k++) {
        const ri = resCycleIdx.get(op.resourceId) ?? 0
        resCycleIdx.set(op.resourceId, ri + 1)
        const epsCycle = (seeded(`${noiseKey}:c:${k}`) - 0.5) * 2 * this.NOISE
        const epsSetup = (seeded(`${noiseKey}:s:${k}`) - 0.5) * 2 * this.NOISE
        const ramp = opDrift ? Math.pow(Math.min(1, ri / opDrift.rampOverEvents), opDrift.curve ?? 1) : 0
        const driftCycle = opDrift && opDrift.param === 'cycle' ? 1 + opDrift.magnitude * ramp : 1
        const driftSetup = opDrift && opDrift.param === 'setup' ? 1 + opDrift.magnitude * ramp : 1
        const actualCycle = stdCycle * (1 + epsCycle) * driftCycle
        const actualSetup = stdSetup * (1 + epsSetup) * driftSetup
        const yieldFrac = this.YIELD + (seeded(`${noiseKey}:y:${k}`) - 0.5) * 0.04
        // A slower cycle produces fewer pieces in the same window → the drifted line
        // falls behind plan (the variance beat); throughput scales by std/actual cycle.
        const throughputFrac = actualCycle > 0 ? Math.min(1, stdCycle / actualCycle) : 1
        const goodQty = Math.max(0, Math.round(op.plannedQty * yieldFrac * throughputFrac))
        const durMin = actualSetup + actualCycle * op.plannedQty
        // Delivery: normally [start, start+run]. An OTIF-miss order's last op finished past its due —
        // the whole op slides LATE (start AND end shift together), so the run length is unchanged and
        // OEE is untouched; only the delivery (end vs due) moves. Other ops keep their planned start.
        const due = dueByLine.get(op.demandLineId)
        let startMs = opStart.getTime()
        let endMs = startMs + durMin * 60_000
        if (lateFinish && due != null) {
          endMs = Math.max(endMs, due + this.OTIF_LATE_MS)
          startMs = endMs - durMin * 60_000
        }
        const payload: ExecutionActualPayload = {
          actualEventId: `${version.id}:${op.id}:${k}`,
          scheduleVersionId: version.id,
          scheduledOperationId: op.id,
          resourceId: op.resourceId,
          routingOperationId: op.routingOperationId,
          partId: op.partId,
          actualStart: new Date(startMs).toISOString(),
          actualEnd: new Date(endMs).toISOString(),
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
