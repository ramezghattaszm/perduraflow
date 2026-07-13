/**
 * Comparative + narration byte-identical baseline harness — Scheduling S1.3 Commit-0b (the THIRD proof).
 *
 * Proof (2) (`objective:baseline`) pins `scorePlan`'s output — but `scorePlan` returns
 * `{score, kpis, factors, constraints}` and STOPS there. The comparative layer sits ABOVE it: the what-if
 * service compares factor CONTRIBUTIONS across options to derive `OptionComparative.decidingFactors[].key`
 * (typed on `RationaleFactorKey` — the type Option B reshapes) + the verdict, then the narration
 * (`whatif.narration.ts`, `FACTOR_NAME[d.key]`) turns those into the demo's "why the winner won" text and
 * recommendation. So a Commit-1 regression could leave the plan digest green AND the objective digest green
 * AND the narration wrong. This harness closes that gap.
 *
 * It runs a multi-option fixture (≥2 scored plans, incl. contested deciding factors and a target-remediation
 * case) through the REAL comparative builder (`buildComparatives`, which the service's private method now
 * delegates to) and the REAL narration (`optionNarrationInput`), and digests `vsOptionId`, `deltaScore`,
 * `verdict`, `decidingFactors[].key/delta`, and the narrated fact lines. Pure / DB-free / date-insensitive,
 * like the objective harness — a fixed target every S1.3 commit must reproduce EXACTLY.
 *
 * Usage:
 *   tsx src/db/comparative-baseline.ts               # print scenario count + digest
 *   tsx src/db/comparative-baseline.ts --save <path> # write the reference JSON (the diff target)
 *   tsx src/db/comparative-baseline.ts --check <path># diff against a saved reference; exit 1 on mismatch
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { OBJECTIVE_DEFAULTS, OBJECTIVE_DEFAULT_VERSION, type StructuredRationale, type WhatIfOption } from '@perduraflow/contracts'
import type { Placement } from '../modules/scheduling/sequencer'
import { buildComparatives, type ComparativeInput } from '../modules/scheduling/whatif.service'
import { scorePlan, type ResourceRate } from '../modules/scheduling/whatif.scoring'
import { optionNarrationInput } from '../modules/scheduling/whatif.narration'

const H = 3_600_000

const pl = (o: Partial<Placement>): Placement => ({
  demandLineId: 'D-0001',
  partId: 'PA',
  routingOperationId: 'RO-1',
  resourceId: 'R1',
  opSeq: 1,
  sequencePosition: 1,
  plannedStartMs: 0,
  plannedEndMs: 8 * H,
  qty: 100,
  setupTime: 30,
  cycleTime: 2,
  setupSource: 'standard',
  cycleSource: 'standard',
  setupConfidence: null,
  cycleConfidence: null,
  atRisk: false,
  atRiskReason: null,
  placedFeasible: true,
  bindingKind: 'origin',
  bindingBlockerDemandLineId: null,
  bindingBlockerOpSeq: null,
  bindingDowntimeId: null,
  bindingOperatorId: null,
  operatorLaborRate: null,
  requiredDateMs: 1000 * H,
  firmness: 'firm',
  changeoverValue: null,
  ...o,
})

const RATES = new Map<string, ResourceRate>([
  ['R1', { setupCost: 50, runCostPerHour: 60, overheadPerUnit: 0.5 }],
  ['R2', { setupCost: 40, runCostPerHour: 80, overheadPerUnit: 0.25 }],
])

// Three options over the same demand — optA is the current plan (base for displacement).
// optA: D-0002 firm-LATE on R1. optB: D-0002 rerouted to R2 (on time; displacement). optC: D-0002 on time
// on R1 via overtime (no reroute; OT instead of displacement) → optB-vs-optC is a genuine tradeoff.
const OPT_A: Placement[] = [
  pl({ demandLineId: 'D-0001', resourceId: 'R1', sequencePosition: 1, changeoverValue: 'A', plannedEndMs: 6 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0002', resourceId: 'R1', sequencePosition: 2, changeoverValue: 'B', plannedEndMs: 30 * H, requiredDateMs: 20 * H, atRisk: true }),
  pl({ demandLineId: 'D-0003', resourceId: 'R1', sequencePosition: 3, changeoverValue: 'B', plannedEndMs: 12 * H, requiredDateMs: 40 * H }),
  pl({ demandLineId: 'D-0004', resourceId: 'R2', sequencePosition: 1, qty: 50, operatorLaborRate: 45, plannedEndMs: 5 * H, requiredDateMs: 20 * H }),
]
const OPT_B: Placement[] = [
  pl({ demandLineId: 'D-0001', resourceId: 'R1', sequencePosition: 1, changeoverValue: 'A', plannedEndMs: 6 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0002', resourceId: 'R2', sequencePosition: 2, changeoverValue: 'B', plannedEndMs: 18 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0003', resourceId: 'R1', sequencePosition: 2, changeoverValue: 'B', plannedEndMs: 12 * H, requiredDateMs: 40 * H }),
  pl({ demandLineId: 'D-0004', resourceId: 'R2', sequencePosition: 1, qty: 50, operatorLaborRate: 45, plannedEndMs: 5 * H, requiredDateMs: 20 * H }),
]
const OPT_C: Placement[] = [
  pl({ demandLineId: 'D-0001', resourceId: 'R1', sequencePosition: 1, changeoverValue: 'A', plannedEndMs: 6 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0002', resourceId: 'R1', sequencePosition: 2, changeoverValue: 'B', plannedEndMs: 18 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0003', resourceId: 'R1', sequencePosition: 3, changeoverValue: 'B', plannedEndMs: 12 * H, requiredDateMs: 40 * H }),
  pl({ demandLineId: 'D-0004', resourceId: 'R2', sequencePosition: 1, qty: 50, operatorLaborRate: 45, plannedEndMs: 5 * H, requiredDateMs: 20 * H }),
]

interface OptFix {
  id: string
  labelKey: string
  placements: Placement[]
  overtimeHours: number
}

interface ComparativeScenario {
  label: string
  targetDemandLineId: string | null
  recommendedId: string
  opts: OptFix[]
}

const SCENARIOS: ComparativeScenario[] = [
  {
    label: 'plantwide-tradeoff',
    targetDemandLineId: null,
    recommendedId: 'reroute',
    opts: [
      { id: 'balanced', labelKey: 'whatif.option.balanced', placements: OPT_A, overtimeHours: 0 },
      { id: 'reroute', labelKey: 'whatif.option.reroute', placements: OPT_B, overtimeHours: 0 },
      { id: 'overtime', labelKey: 'whatif.option.overtime', placements: OPT_C, overtimeHours: 8 },
    ],
  },
  {
    label: 'target-remediation-D-0002',
    targetDemandLineId: 'D-0002',
    recommendedId: 'reroute',
    opts: [
      { id: 'balanced', labelKey: 'whatif.option.balanced', placements: OPT_A, overtimeHours: 0 },
      { id: 'reroute', labelKey: 'whatif.option.reroute', placements: OPT_B, overtimeHours: 0 },
    ],
  },
]

const canon = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : Array.isArray(v)
      ? v.map(canon)
      : v
const sha = (o: unknown) => createHash('sha256').update(JSON.stringify(canon(o))).digest('hex')

function capture() {
  return SCENARIOS.map((s) => {
    // Score every option; base = the FIRST option's plan (the "current plan" for displacement).
    const base = s.opts[0]!.placements
    const scored = s.opts.map((o) => ({
      o,
      s: scorePlan(o.placements, { rateByResource: RATES, basePlacements: base, overtimeHours: o.overtimeHours, weights: OBJECTIVE_DEFAULTS }),
    }))
    const inputs: ComparativeInput[] = scored.map(({ o, s: sc }) => ({ id: o.id, score: sc.score, factors: sc.factors, placements: o.placements }))

    // Build the real all-pairwise comparatives per option, then the real narration facts.
    const options: WhatIfOption[] = scored.map(({ o, s: sc }, i) => {
      const comparatives = buildComparatives(inputs[i]!, inputs, s.targetDemandLineId)
      const rationale: StructuredRationale = {
        schemaVersion: '1',
        weightSetVersion: OBJECTIVE_DEFAULT_VERSION,
        optionId: o.id,
        score: sc.score,
        headlineKey: 'whatif.headline.option',
        headlineParams: {},
        factors: sc.factors,
        constraints: sc.constraints,
        comparatives,
      }
      return { id: o.id, rank: i + 1, labelKey: o.labelKey, feasible: true, infeasibleReasonKey: null, kpis: sc.kpis, score: sc.score, rationale, targetOutcome: null }
    })

    const perOption = options.map((opt) => ({
      id: opt.id,
      score: opt.score,
      comparatives: opt.rationale.comparatives,
      narration: optionNarrationInput(opt, options, s.recommendedId).facts,
    }))
    return { label: s.label, targetDemandLineId: s.targetDemandLineId, recommendedId: s.recommendedId, options: perOption }
  })
}

function main(): void {
  const surface = capture()
  const digest = sha(surface)

  const saveIdx = process.argv.indexOf('--save')
  const checkIdx = process.argv.indexOf('--check')

  console.log('comparative + narration baseline')
  console.log(`  scenarios : ${surface.length}`)
  console.log(`  digest    : ${digest}`)
  for (const sc of surface) {
    console.log(`    ${sc.label}  (target=${sc.targetDemandLineId ?? 'none'}, rec=${sc.recommendedId})`)
    for (const o of sc.options) {
      const verdicts = o.comparatives.map((c) => `${c.vsOptionId}:${c.verdict}[${c.decidingFactors.map((d) => d.key).join(',')}]`).join(' ')
      console.log(`      ${o.id.padEnd(10)} score=${o.score}  ${verdicts}`)
    }
  }

  if (saveIdx !== -1) {
    const path = process.argv[saveIdx + 1]!
    writeFileSync(path, JSON.stringify({ digest, surface }, null, 2))
    console.log(`  ✓ saved reference → ${path}`)
  }
  if (checkIdx !== -1) {
    const path = process.argv[checkIdx + 1]!
    const ref = JSON.parse(readFileSync(path, 'utf8')) as { digest: string }
    if (ref.digest !== digest) {
      console.error(`  ✗ COMPARATIVE BASELINE MISMATCH — the comparative/narration surface changed`)
      console.error(`    digest: ${ref.digest} (ref) vs ${digest} (now)`)
      process.exit(1)
    }
    console.log(`  ✓ comparative/narration surface byte-identical to the reference (${path})`)
  }
}

main()
