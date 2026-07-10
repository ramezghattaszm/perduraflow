/**
 * Committed-plan byte-identical baseline harness (Scheduling S1 Commit-0).
 *
 * The reference every S1.1 mechanism-extraction commit diffs against: the extraction of the inline
 * constraint logic into the registry must leave the SEQUENCER OUTPUT byte-identical. This dumps the full
 * committed plan (both plants) from the current DB — the persisted `scheduled_operation` rows, which ARE the
 * placements — into a canonical, **ULID-free** digest, so the digest is a pure function of the sequencer
 * logic (the seed + calendar held fixed), not of the per-run ids the seed mints.
 *
 * Canonicalization (why the digest is stable across resets, unstable only if the *logic* changes):
 *  - per-run ULIDs are mapped to stable business keys: `resource_id → resource.name`, `part_id → part.part_no`;
 *    `demand_line_id` is already the seed's stable `D-####` key; blocker refs likewise.
 *  - absolute timestamps are normalized to **offset-from-the-version-horizon** (`planned_start − horizon_start`)
 *    + duration, so a reset on a different calendar DATE still yields the same relative plan structure
 *    (caveat: a reset on a different WEEKDAY can shift which working windows ops land in — re-baseline then;
 *    the primary use is a same-session A/B: capture on pre-extraction code, `--check` after each mechanism).
 *  - `id`/`schedule_version_id`/`optimizer_run_id`/`created_at`/`master_data_asof` are per-run identifiers,
 *    excluded (they are not plan CONTENT).
 *
 * The committed EDD plan is independent of the objective/reporting/autonomy config groups (solve() places by
 * EDD; it never calls scorePlan) — so the objective determinism token is reported for completeness (it is the
 * scheduler determinism-key input for what-if) but is NOT a plan input; in the demo it is the default `aps-w2`.
 *
 * Usage:
 *   tsx src/db/plan-baseline.ts               # print op count + per-resource counts + digest
 *   tsx src/db/plan-baseline.ts --save <path> # also write the reference JSON (the diff target)
 *   tsx src/db/plan-baseline.ts --check <path># diff against a saved reference; exit 1 on any mismatch
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { Pool } from 'pg'
import { env } from '../config/env'

/** One committed-plan op in ULID-free, canonical form (the digest input). */
interface PlanOp {
  demandLineId: string
  partNo: string
  resourceName: string
  opSeq: number
  sequencePosition: number
  startOffsetMs: number // planned_start − version horizon_start (date-shift stable)
  durationMs: number // planned_end − planned_start
  plannedQty: number
  setupTime: number
  cycleTime: number
  setupSource: string
  cycleSource: string
  setupConfidence: number | null
  cycleConfidence: number | null
  atRisk: boolean
  atRiskReason: string | null
  bindingKind: string | null
  bindingBlockerDemandLineId: string | null
  bindingBlockerOpSeq: number | null
  bindingDowntime: boolean // whether a downtime window bound the start (ULID mapped to a boolean)
  bindingOperatorName: string | null // operator ULID mapped to the stable operator name
}

/** Recursively key-sorted JSON so the digest is field-order-independent. */
const canon = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : Array.isArray(v)
      ? v.map(canon)
      : v
const sha = (o: unknown) => createHash('sha256').update(JSON.stringify(canon(o))).digest('hex')

async function capturePlan(pool: Pool): Promise<{ ops: PlanOp[]; byResource: Record<string, number> }> {
  const { rows } = await pool.query<{
    demand_line_id: string
    part_no: string
    resource_name: string
    op_seq: number
    sequence_position: number
    start_offset_ms: string
    duration_ms: string
    planned_qty: number
    setup_time: number
    cycle_time: number
    setup_source: string
    cycle_source: string
    setup_confidence: number | null
    cycle_confidence: number | null
    at_risk: boolean
    at_risk_reason: string | null
    binding_kind: string | null
    binding_blocker_demand_line_id: string | null
    binding_blocker_op_seq: number | null
    has_downtime_bind: boolean
    binding_operator_name: string | null
  }>(`
    SELECT so.demand_line_id, p.part_no, r.name AS resource_name, so.op_seq, so.sequence_position,
           round(extract(epoch FROM (so.planned_start - v.horizon_start)) * 1000)::bigint AS start_offset_ms,
           round(extract(epoch FROM (so.planned_end   - so.planned_start)) * 1000)::bigint AS duration_ms,
           so.planned_qty, so.setup_time, so.cycle_time, so.setup_source, so.cycle_source,
           so.setup_confidence, so.cycle_confidence, so.at_risk, so.at_risk_reason, so.binding_kind,
           so.binding_blocker_demand_line_id, so.binding_blocker_op_seq,
           (so.binding_downtime_id IS NOT NULL) AS has_downtime_bind,
           bo.name AS binding_operator_name
    FROM scheduling.scheduled_operation so
    JOIN scheduling.schedule_version v ON v.id = so.schedule_version_id AND v.status = 'committed'
    JOIN master_data.resource r ON r.id = so.resource_id
    JOIN master_data.part p ON p.id = so.part_id
    LEFT JOIN master_data.operator bo ON bo.id = so.binding_operator_id
  `)

  const ops: PlanOp[] = rows.map((r) => ({
    demandLineId: r.demand_line_id,
    partNo: r.part_no,
    resourceName: r.resource_name,
    opSeq: r.op_seq,
    sequencePosition: r.sequence_position,
    startOffsetMs: Number(r.start_offset_ms),
    durationMs: Number(r.duration_ms),
    plannedQty: r.planned_qty,
    setupTime: r.setup_time,
    cycleTime: r.cycle_time,
    setupSource: r.setup_source,
    cycleSource: r.cycle_source,
    setupConfidence: r.setup_confidence,
    cycleConfidence: r.cycle_confidence,
    atRisk: r.at_risk,
    atRiskReason: r.at_risk_reason,
    bindingKind: r.binding_kind,
    bindingBlockerDemandLineId: r.binding_blocker_demand_line_id,
    bindingBlockerOpSeq: r.binding_blocker_op_seq,
    bindingDowntime: r.has_downtime_bind,
    bindingOperatorName: r.binding_operator_name,
  }))

  // Deterministic total order (resources are plant-unique, so this disjoins the two committed plans).
  ops.sort(
    (a, b) =>
      a.resourceName.localeCompare(b.resourceName) ||
      a.sequencePosition - b.sequencePosition ||
      a.demandLineId.localeCompare(b.demandLineId) ||
      a.opSeq - b.opSeq,
  )

  const byResource: Record<string, number> = {}
  for (const o of ops) byResource[o.resourceName] = (byResource[o.resourceName] ?? 0) + 1
  return { ops, byResource }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  try {
    const { ops, byResource } = await capturePlan(pool)
    const digest = sha(ops)
    const summary = { opCount: ops.length, digest, byResource, objectiveToken: 'aps-w2 (default — no objective override seeded; not a committed-plan input)' }

    const saveIdx = process.argv.indexOf('--save')
    const checkIdx = process.argv.indexOf('--check')

    console.log('committed-plan baseline')
    console.log(`  op count : ${summary.opCount}`)
    console.log(`  digest   : ${digest}`)
    console.log(`  by resource: ${JSON.stringify(byResource)}`)
    console.log(`  objective token: ${summary.objectiveToken}`)

    if (saveIdx !== -1) {
      const path = process.argv[saveIdx + 1]!
      writeFileSync(path, JSON.stringify({ opCount: ops.length, digest, byResource, ops }, null, 2))
      console.log(`  ✓ saved reference → ${path}`)
    }
    if (checkIdx !== -1) {
      const path = process.argv[checkIdx + 1]!
      const ref = JSON.parse(readFileSync(path, 'utf8')) as { opCount: number; digest: string }
      if (ref.opCount !== ops.length || ref.digest !== digest) {
        console.error(`  ✗ BASELINE MISMATCH — the committed plan changed`)
        console.error(`    op count: ${ref.opCount} (ref) vs ${ops.length} (now)`)
        console.error(`    digest  : ${ref.digest} (ref) vs ${digest} (now)`)
        await pool.end()
        process.exit(1)
      }
      console.log(`  ✓ byte-identical to the reference (${path})`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
