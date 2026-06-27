import * as bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import { tenant } from '../modules/tenant/schema'
import { approvalTier, role, user } from '../modules/auth/schema'
import {
  calendar,
  customer,
  plant,
  plantGroup,
  plantGroupMember,
  program,
} from '../modules/org/schema'
import {
  certification,
  operator,
  operatorQualification,
  part,
  resource,
  resourceGroup,
  resourceGroupMember,
  resourceTypeConfig,
  routing,
  routingOperation,
} from '../modules/master-data/schema'
import { contractBinding } from '../modules/binding/schema'
import {
  demandInput,
  historicalOutcome,
  materialAvailability,
  materialRequirement,
  resourceOperatorAssignment,
} from '../modules/scheduling/schema'
import { configOverride } from '../modules/config/schema'

/**
 * Phase-0 seed (install-and-go defaults, D48). Idempotent. Aggregates every
 * module's schema — like the migration generator, the seed is an explicit,
 * exempt aggregator (api-spec §0 O3). Creates: one tenant, the approval-tier
 * ladder, the seeded editable role set (D33/§3.1), an admin user, and a couple
 * of sample plants/groups/customers/programs/calendars.
 */
const DEFAULT_PASSWORD = 'Password123'
const ADMIN_EMAIL = 'admin@perduraflow.test'

/** D33 §3.1 — the seeded default role set; all editable. */
const SEED_ROLES = [
  { name: 'Operator / line lead', dataScope: 'plant', tier: null, canConfigure: false },
  { name: 'Scheduler / planner', dataScope: 'plant', tier: 'Planner', canConfigure: false },
  { name: 'Supervisor', dataScope: 'plant', tier: 'Supervisor', canConfigure: false },
  { name: 'Plant manager', dataScope: 'plant', tier: 'Plant manager', canConfigure: false },
  { name: 'Materials / logistics', dataScope: 'plant', tier: null, canConfigure: false },
  { name: 'Multi-plant / exec', dataScope: 'multi_plant', tier: null, canConfigure: false },
  { name: 'Maintenance / tooling', dataScope: 'plant', tier: null, canConfigure: false },
  { name: 'Admin / configurator', dataScope: 'tenant', tier: null, canConfigure: true },
] as const

const SEED_TIERS = [
  { name: 'Planner', rank: 1 },
  { name: 'Supervisor', rank: 2 },
  { name: 'Plant manager', rank: 3 },
] as const

/**
 * Seed the deterministic baseline (idempotent). Exported so `demo:reset`
 * (reset.ts) can re-run it after truncating; the CLI entry below runs it for
 * `db:seed`.
 */
export async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  const db = drizzle(pool)

  // --- tenant ----------------------------------------------------------------
  // Demo client identity for the shell's brand zone. logoUrl stays null so the
  // OrgAvatar placeholder shows — real logos are tenant-supplied (SKIP-53).
  const DEMO_TENANT = { name: 'Magna de México', logoUrl: null as string | null }
  const existingTenant = (await db.select().from(tenant).limit(1))[0]
  const tenantRow = existingTenant ?? (await db.insert(tenant).values(DEMO_TENANT).returning())[0]
  if (existingTenant)
    await db.update(tenant).set(DEMO_TENANT).where(eq(tenant.id, existingTenant.id))
  const tenantId = tenantRow!.id
  console.log(`  ✓ tenant: ${tenantId}`)

  // --- approval tiers --------------------------------------------------------
  const tierIdByName = new Map<string, string>()
  const existingTiers = await db
    .select()
    .from(approvalTier)
    .where(eq(approvalTier.tenantId, tenantId))
  for (const t of SEED_TIERS) {
    const found = existingTiers.find((r) => r.name === t.name)
    if (found) {
      tierIdByName.set(t.name, found.id)
    } else {
      const [created] = await db
        .insert(approvalTier)
        .values({ tenantId, name: t.name, rank: t.rank })
        .returning()
      tierIdByName.set(t.name, created!.id)
      console.log(`  ✓ approval tier: ${t.name}`)
    }
  }

  // --- roles -----------------------------------------------------------------
  const roleIdByName = new Map<string, string>()
  const existingRoles = await db.select().from(role).where(eq(role.tenantId, tenantId))
  for (const r of SEED_ROLES) {
    const found = existingRoles.find((row) => row.name === r.name)
    if (found) {
      roleIdByName.set(r.name, found.id)
      continue
    }
    const [created] = await db
      .insert(role)
      .values({
        tenantId,
        name: r.name,
        isDefaultSeed: true,
        dataScope: r.dataScope,
        approvalTierId: r.tier ? (tierIdByName.get(r.tier) ?? null) : null,
        canConfigure: r.canConfigure,
      })
      .returning()
    roleIdByName.set(r.name, created!.id)
    console.log(`  ✓ role: ${r.name}`)
  }

  // --- admin user ------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
  const existingAdmin = await db.select().from(user).where(eq(user.email, ADMIN_EMAIL))
  if (existingAdmin.length === 0) {
    await db.insert(user).values({
      tenantId,
      name: 'Admin',
      email: ADMIN_EMAIL,
      passwordHash,
      isVerified: true,
      roleId: roleIdByName.get('Admin / configurator') ?? null,
    })
    console.log(`  ✓ user: ${ADMIN_EMAIL} (Admin / configurator)`)
  }

  // --- Magna de México scenario (SEED-SCENARIO-SPEC) -------------------------
  // ONE coherent, illustrative dataset (an informed guess — NOT Magna's real data)
  // driving all six views + the four collisions. Every displayed figure computes
  // from these inputs through the real path (no hardcoded outputs). Guarded so a
  // standalone `db:seed` is idempotent; `demo:reset` truncates first.
  const existingPlants = await db.select().from(plant).where(eq(plant.tenantId, tenantId))
  if (existingPlants.length === 0) {
    type ChangeoverKey = 'colour' | 'material' | 'gauge' | null
    // plants — Coahuila cluster shares resources (allocation context); Monterrey light.
    const [saltillo] = await db
      .insert(plant)
      .values({
        tenantId,
        name: 'Saltillo Stamping',
        timezone: 'America/Mexico_City',
        region: 'Coahuila',
      })
      .returning()
    const [ramos] = await db
      .insert(plant)
      .values({
        tenantId,
        name: 'Ramos Arizpe Welding',
        timezone: 'America/Mexico_City',
        region: 'Coahuila',
      })
      .returning()
    await db
      .insert(plant)
      .values({
        tenantId,
        name: 'Monterrey Components',
        timezone: 'America/Monterrey',
        region: 'Nuevo León',
      })
    const [cluster] = await db
      .insert(plantGroup)
      .values({
        tenantId,
        name: 'Coahuila cluster',
        groupType: 'cluster',
        allowsResourceSharing: true,
      })
      .returning()
    await db.insert(plantGroupMember).values([
      { tenantId, plantGroupId: cluster!.id, plantId: saltillo!.id },
      { tenantId, plantGroupId: cluster!.id, plantId: ramos!.id },
    ])

    // customers (priority tiers — View 5; priority set on insert) + programs
    const [gm] = await db
      .insert(customer)
      .values({ tenantId, name: 'General Motors', firmFenceDays: 14, priority: 'critical' })
      .returning()
    const [stellantis] = await db
      .insert(customer)
      .values({ tenantId, name: 'Stellantis', firmFenceDays: 14, priority: 'critical' })
      .returning()
    const [nissan] = await db
      .insert(customer)
      .values({ tenantId, name: 'Nissan Mexicana', firmFenceDays: 10, priority: 'high' })
      .returning()
    const [aftermarket] = await db
      .insert(customer)
      .values({
        tenantId,
        name: 'Aftermarket / Service Parts',
        firmFenceDays: 7,
        priority: 'standard',
      })
      .returning()
    const [gmProgram] = await db
      .insert(program)
      .values({ tenantId, customerId: gm!.id, name: 'Silverado/Sierra body', firmFenceDays: 21 })
      .returning()
    const [stelProgram] = await db
      .insert(program)
      .values({
        tenantId,
        customerId: stellantis!.id,
        name: 'RAM 1500 underbody',
        firmFenceDays: 18,
      })
      .returning()

    // calendars — one standard two-shift pattern per producing plant (Mon–Sat, 06:00–22:00;
    // Sunday closed). workingDays drives the calendar-aware sequencer (D-shift).
    const shifts = {
      shiftPatterns: [
        { name: 'A', start: '06:00', end: '14:00' },
        { name: 'B', start: '14:00', end: '22:00' },
      ],
      holidays: [],
      workingDays: [1, 2, 3, 4, 5, 6],
    }
    const [calSaltillo] = await db
      .insert(calendar)
      .values({ tenantId, plantId: saltillo!.id, name: 'Saltillo two-shift', ...shifts })
      .returning()
    const [calRamos] = await db
      .insert(calendar)
      .values({ tenantId, plantId: ramos!.id, name: 'Ramos Arizpe two-shift', ...shifts })
      .returning()

    // resources + Tier-B cost rates (Master-Data-owned; scheduling computes cost/unit)
    const [pressA] = await db
      .insert(resource)
      .values({
        tenantId,
        name: 'Press Line A',
        resourceType: 'line',
        plantId: saltillo!.id,
        calendarId: calSaltillo!.id,
        rate: 12,
        rateUom: 'strokes/min',
        runCostPerHour: 145,
        setupCost: 130,
        overheadPerUnit: 0.65,
      })
      .returning()
    const [pressB] = await db
      .insert(resource)
      .values({
        tenantId,
        name: 'Press Line B',
        resourceType: 'line',
        plantId: saltillo!.id,
        calendarId: calSaltillo!.id,
        rate: 11,
        rateUom: 'strokes/min',
        runCostPerHour: 140,
        setupCost: 125,
        overheadPerUnit: 0.6,
      })
      .returning()
    const [weld1] = await db
      .insert(resource)
      .values({
        tenantId,
        name: 'Weld Cell 1',
        resourceType: 'cell',
        plantId: ramos!.id,
        calendarId: calRamos!.id,
        runCostPerHour: 98,
        setupCost: 75,
        overheadPerUnit: 0.48,
      })
      .returning()
    const [weld2] = await db
      .insert(resource)
      .values({
        tenantId,
        name: 'Weld Cell 2',
        resourceType: 'cell',
        plantId: ramos!.id,
        calendarId: calRamos!.id,
        runCostPerHour: 95,
        setupCost: 70,
        overheadPerUnit: 0.45,
      })
      .returning()
    // Collision-3 (inspection capacity, C3): a single finite leak-test station at Ramos that
    // every welded part must pass through after welding (a routing op → this group). One
    // station = the hard capacity; welds finishing close together queue for it → later ones
    // at-risk. The LEAK certification (Workforce view) composes as "who staffs it"; the
    // station is the hard gate (deviates from the D29/D54 cert-skill-pool model for demo
    // visibility — deferred reconciliation).
    const [leakStation] = await db
      .insert(resource)
      .values({
        tenantId,
        name: 'Leak-Test Station',
        resourceType: 'work_center',
        plantId: ramos!.id,
        calendarId: calRamos!.id,
        runCostPerHour: 60,
        setupCost: 20,
        overheadPerUnit: 0.1,
      })
      .returning()
    // Resource-type shift config (D-shift): presses AND weld cells run non-interruptible
    // (non-splittable) — a job must complete in one contiguous working window, so the optimizer
    // schedules each whole rather than parking it across the 22:00 shift boundary. Both may run up
    // to 4h/day overtime past shift-end (an extended shift) — the ceiling the what-if
    // "overtime" option spends; a normal solve uses none. 4h is enough that, against a
    // moderate disruption on a realistically-full line, OT genuinely competes with reroute
    // (finish on the same line late-but-OT vs move work elsewhere) instead of collapsing.
    // The leak-test work-centre runs in-shift (non-splittable, no OT) — a clean queue.
    // minBatchQty (C4): minimum run-length floor per type, set comfortably BELOW every seeded
    // demand qty (smallest is 200) so it never binds by default — the constraint is real and
    // configurable, the proof is config-driven (drop a demand below 100 via the launcher → it binds).
    await db.insert(resourceTypeConfig).values([
      { tenantId, resourceType: 'line', splittable: false, otCapMinutes: 240, minBatchQty: 100 },
      { tenantId, resourceType: 'cell', splittable: false, otCapMinutes: 240, minBatchQty: 100 },
      {
        tenantId,
        resourceType: 'work_center',
        splittable: false,
        otCapMinutes: 0,
        minBatchQty: 100,
      },
    ])
    const [pressGrp] = await db
      .insert(resourceGroup)
      .values({ tenantId, name: 'Saltillo stamping presses', plantId: saltillo!.id })
      .returning()
    const [weldGrp] = await db
      .insert(resourceGroup)
      .values({ tenantId, name: 'Ramos weld cells', plantId: ramos!.id })
      .returning()
    const [leakGrp] = await db
      .insert(resourceGroup)
      .values({ tenantId, name: 'Ramos leak-test', plantId: ramos!.id })
      .returning()
    await db.insert(resourceGroupMember).values([
      { tenantId, resourceGroupId: pressGrp!.id, resourceId: pressA!.id },
      { tenantId, resourceGroupId: pressGrp!.id, resourceId: pressB!.id },
      { tenantId, resourceGroupId: weldGrp!.id, resourceId: weld1!.id },
      { tenantId, resourceGroupId: weldGrp!.id, resourceId: weld2!.id },
      { tenantId, resourceGroupId: leakGrp!.id, resourceId: leakStation!.id },
    ])

    // parts (specific automotive components — informed guess; physical attrs drive changeover)
    const mkPart = async (v: {
      partNo: string
      description: string
      material: string
      gauge: string
      colour?: string
    }): Promise<string> =>
      (
        await db
          .insert(part)
          .values({ tenantId, partType: 'finished', uom: 'EA', colour: null, ...v })
          .returning()
      )[0]!.id
    const fg2001 = await mkPart({
      partNo: 'FG-2001',
      description: 'Rear floor cross-member',
      material: 'Steel HSLA',
      gauge: '1.5mm',
      colour: 'Black',
    })
    const fg2002 = await mkPart({
      partNo: 'FG-2002',
      description: 'B-pillar reinforcement, LH',
      material: 'Steel',
      gauge: '1.2mm',
      colour: 'Silver',
    })
    const fg2004 = await mkPart({
      partNo: 'FG-2004',
      description: 'Front seat cross-member',
      material: 'Steel',
      gauge: '1.0mm',
      colour: 'Black',
    })
    const fg3001 = await mkPart({
      partNo: 'FG-3001',
      description: 'Front rail weldment, LH',
      material: 'Steel',
      gauge: '2.0mm',
    })
    const fg3002 = await mkPart({
      partNo: 'FG-3002',
      description: 'Rear shock-tower weldment',
      material: 'Steel',
      gauge: '1.8mm',
    })
    // Collision-3: a purchased component (PV-22) consumed by FG-3001 (welded at Ramos). Now a
    // LIVE mechanism via the scheduler material gate (D36): a requirement link + a seeded
    // availability date drive an earliest-start floor on the consuming weld op.
    const [pv22] = await db
      .insert(part)
      .values({
        tenantId,
        partNo: 'PV-22',
        description: 'Reinforcement gusset (purchased) — Collision-3: FG-3001 material gate',
        partType: 'component',
        uom: 'EA',
        material: 'Steel',
        gauge: '2.0mm',
      })
      .returning()

    // routings (1 primary op each; std times = the `standard` baseline, D7).
    // Stamped FGs → presses (changeover on colour); welded FGs → weld cells (on material).
    const mkRouting = async (
      partId: string,
      name: string,
      groupId: string,
      setup: number,
      cycle: number,
      key: ChangeoverKey
    ): Promise<string> => {
      const [rt] = await db
        .insert(routing)
        .values({ tenantId, partId, name, isPrimary: true })
        .returning()
      await db
        .insert(routingOperation)
        .values({
          tenantId,
          routingId: rt!.id,
          opSeq: 10,
          resourceGroupId: groupId,
          stdSetupTime: setup,
          stdCycleTime: cycle,
          changeoverAttributeKey: key,
        })
      return rt!.id
    }
    await mkRouting(fg2001, 'FG-2001 primary', pressGrp!.id, 30, 0.3, 'colour')
    await mkRouting(fg2002, 'FG-2002 primary', pressGrp!.id, 30, 0.3, 'colour')
    await mkRouting(fg2004, 'FG-2004 primary', pressGrp!.id, 28, 0.32, 'colour')
    const rt3001 = await mkRouting(fg3001, 'FG-3001 primary', weldGrp!.id, 22, 1.4, 'material')
    const rt3002 = await mkRouting(fg3002, 'FG-3002 primary', weldGrp!.id, 20, 1.45, 'material')
    // C3: welded parts pass a leak test (opSeq 20) on the single Leak-Test Station after
    // welding — the linear-precedence successor (floored on the weld's end) that contends
    // for the one station. Modest per-unit inspection time so the station is a real bottleneck.
    const mkInspection = async (routingId: string): Promise<void> => {
      await db
        .insert(routingOperation)
        .values({
          tenantId,
          routingId,
          opSeq: 20,
          resourceGroupId: leakGrp!.id,
          stdSetupTime: 10,
          stdCycleTime: 0.4,
          changeoverAttributeKey: null,
        })
    }
    await mkInspection(rt3001)
    await mkInspection(rt3002)

    // certifications (MD15)
    const mkCert = async (code: string, name: string, description: string): Promise<string> =>
      (await db.insert(certification).values({ tenantId, code, name, description }).returning())[0]!
        .id
    const leak = await mkCert('LEAK', 'Leak test', 'Leak-test station qualification')
    const torque = await mkCert('TORQUE', 'Torque-critical', 'Torque-critical fastening')
    const cmm = await mkCert('CMM', 'CMM inspection', 'Coordinate-measuring inspection')
    const weld = await mkCert('WELD', 'Weld certification', 'MIG / spot weld qualification')
    const adhesive = await mkCert('ADHESIVE', 'Adhesive bonding', 'Structural adhesive application')

    // operators + certs + next-shift presence (Workforce View 3 / Collision 4). The absence REASON
    // drives OT call-in eligibility (D54): not_scheduled = clean call-in; vacation = callable but
    // TENTATIVE (flag it); sick = never called in. Two Ramos gaps demonstrate the ladder:
    //  - LEAK: no present certified operator. Holders are Jorge (off-shift = not_scheduled) and Luis
    //    (SICK, and deliberately CHEAPER) → the engine still picks Jorge, proving sick is excluded
    //    even when it's the cheapest option. A clean (non-tentative) call-in.
    //  - ADHESIVE: only holder is Pedro, on VACATION → a TENTATIVE proposal (confirm first).
    // performanceFactor (C5) = efficiency rating ("percent of standard"): 1.0 standard, higher
    // faster. Most operators run at standard; Ana and Sofía are pointed (slow / fast) so the
    // pinned-assignment effect is visible on the two Saltillo press lines (see assignments below).
    type Absence = 'not_scheduled' | 'sick' | 'vacation' | null
    const mkOp = async (
      name: string,
      plantId: string,
      available: boolean,
      laborRate: number,
      performanceFactor = 1.0,
      absenceReason: Absence = null
    ): Promise<string> =>
      (
        await db
          .insert(operator)
          .values({
            tenantId,
            name,
            homePlantId: plantId,
            available,
            laborRate,
            performanceFactor,
            absenceReason,
          })
          .returning()
      )[0]!.id
    const luis = await mkOp('Luis Cruz', ramos!.id, false, 24.0, 1.0, 'sick') // SICK + cheapest → excluded; proves the rule
    const jorge = await mkOp('Jorge Morales', ramos!.id, false, 26.5, 1.0, 'not_scheduled') // off-shift → the clean leak call-in
    const pedro = await mkOp('Pedro Salas', ramos!.id, false, 25.0, 1.0, 'vacation') // on vacation → tentative adhesive call-in
    const diego = await mkOp('Diego Hernández', ramos!.id, true, 27.0)
    const maria = await mkOp('María Fuentes', ramos!.id, true, 27.5)
    const brunoG = await mkOp('Bruno García', ramos!.id, true, 24.5)
    const ana = await mkOp('Ana Reyes', saltillo!.id, true, 26.0, 0.85) // 85% — slower, lengthens Press Line A
    const sofia = await mkOp('Sofía Ramírez', saltillo!.id, true, 25.5, 1.1) // 110% — faster, shortens Press Line B
    // A FREE faster Saltillo operator (present, unassigned) — the candidate the "assign a faster operator"
    // remediation draws on when Ana's slow run roots an order late. Faster than Ana (1.05) AND pricier
    // ($31.5/h) so applying him clears the lateness but adds visible LABOR cost (wi-12) — the cost-honest
    // trade-off that lets the engine rank faster-operator vs overtime vs reroute on real $ (Part B).
    const mateo = await mkOp('Mateo Ríos', saltillo!.id, true, 31.5, 1.05)
    await db.insert(operatorQualification).values([
      { tenantId, operatorId: luis, certificationId: leak },
      { tenantId, operatorId: luis, certificationId: torque },
      { tenantId, operatorId: jorge, certificationId: leak },
      { tenantId, operatorId: pedro, certificationId: adhesive },
      { tenantId, operatorId: diego, certificationId: weld },
      { tenantId, operatorId: diego, certificationId: torque },
      { tenantId, operatorId: maria, certificationId: weld },
      { tenantId, operatorId: maria, certificationId: cmm },
      { tenantId, operatorId: brunoG, certificationId: cmm },
      { tenantId, operatorId: ana, certificationId: torque },
      { tenantId, operatorId: sofia, certificationId: torque },
      { tenantId, operatorId: mateo, certificationId: torque },
    ])

    // Operator performance assignments (C5, §4.8) — a couple of POINTED pins (not a full roster):
    // Ana (85%) runs Press Line A → its ops run longer; Sofía (110%) runs Press Line B → shorter.
    // Open windows (null from/to) = always in effect. The scheduler consumes these to divide run
    // time by the operator's performanceFactor; production fills this table from a real roster.
    await db.insert(resourceOperatorAssignment).values([
      {
        tenantId,
        plantId: saltillo!.id,
        resourceId: pressA!.id,
        operatorId: ana,
        effectiveFrom: null,
        effectiveTo: null,
      },
      {
        tenantId,
        plantId: saltillo!.id,
        resourceId: pressB!.id,
        operatorId: sofia,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ])

    // binding: masterdata.read → platform_module (the per-tenant counterpart)
    await db
      .insert(contractBinding)
      .values({ tenantId, contractId: 'masterdata.read', major: '1', mode: 'platform_module' })

    // seeded demand (SKIP-10) — the four-collision spine, **anchored to today** so a fresh
    // reset is always current: work lands on the seed day (`+0`) and due dates spread across
    // the coming week (`+N` days), so the board opens on TODAY with editable work and a
    // week of horizon ahead. Re-run any day → it re-anchors. (Day offsets are from today's
    // UTC midnight; the engine still front-loads work to the first working day = today.)
    type Firmness = 'firm' | 'forecast'
    const DAY_MS = 86_400_000
    const baseDay = Math.floor(Date.now() / DAY_MS) * DAY_MS // today, 00:00 UTC, at seed time
    const at = (offsetDays: number, h = 0, m = 0): Date =>
      new Date(baseDay + offsetDays * DAY_MS + h * 3_600_000 + m * 60_000)
    // Quantities are sized for a realistically-FULL plant: with the calendar-aware
    // sequencer (Mon–Sat 06:00–22:00) the two Saltillo presses run ~90% of the day and the
    // two Ramos weld cells ~90% — most of the working day utilized, with normal slack
    // (stamping runs thousands of parts/shift at ~0.3 min/unit). Due dates spread across the
    // week so today's run meets them under EDD; DL-1006 (due before today's shift even
    // opens) is the one COMPUTED-late anchor. This load is what makes the seeded disruptions
    // bite: a demand bump / wear / line-down pushes work past the shift boundary, where OT
    // and lateness become meaningful levers.
    const demand: {
      line: string
      ref: string
      part: string
      plant: string
      cust: string
      prog: string | null
      firm: Firmness
      qty: number
      due: Date
    }[] = [
      // Saltillo (presses) — ~1730 press-minutes across 2 lines ≈ 90% of one shift each.
      {
        line: 'GP-1142',
        ref: 'GM-830-1142',
        part: fg2001,
        plant: saltillo!.id,
        cust: gm!.id,
        prog: gmProgram!.id,
        firm: 'firm',
        qty: 600,
        due: at(1, 12),
      },
      {
        line: 'DL-1002',
        ref: 'GM-830-1002',
        part: fg2002,
        plant: saltillo!.id,
        cust: gm!.id,
        prog: gmProgram!.id,
        firm: 'firm',
        qty: 550,
        due: at(1, 12),
      },
      {
        line: 'DL-1003',
        ref: 'NIS-862-1003',
        part: fg2004,
        plant: saltillo!.id,
        cust: nissan!.id,
        prog: null,
        firm: 'forecast',
        qty: 500,
        due: at(2, 12),
      },
      {
        line: 'DL-1004',
        ref: 'GM-830-1004',
        part: fg2001,
        plant: saltillo!.id,
        cust: gm!.id,
        prog: gmProgram!.id,
        firm: 'firm',
        qty: 450,
        due: at(2, 12),
      },
      {
        line: 'DL-1005',
        ref: 'AM-1005',
        part: fg2004,
        plant: saltillo!.id,
        cust: aftermarket!.id,
        prog: null,
        firm: 'forecast',
        qty: 350,
        due: at(3, 12),
      },
      {
        line: 'DL-1006',
        ref: 'GM-830-1006',
        part: fg2002,
        plant: saltillo!.id,
        cust: gm!.id,
        prog: gmProgram!.id,
        firm: 'firm',
        qty: 350,
        due: at(0, 0, 45),
      }, // due before today's shift → computed late
      {
        line: 'DL-1007',
        ref: 'GM-830-1007',
        part: fg2001,
        plant: saltillo!.id,
        cust: gm!.id,
        prog: gmProgram!.id,
        firm: 'firm',
        qty: 550,
        due: at(1, 18),
      },
      {
        line: 'DL-1008',
        ref: 'NIS-862-1008',
        part: fg2002,
        plant: saltillo!.id,
        cust: nissan!.id,
        prog: null,
        firm: 'firm',
        qty: 500,
        due: at(2, 12),
      },
      {
        line: 'DL-1009',
        ref: 'AM-1009',
        part: fg2004,
        plant: saltillo!.id,
        cust: aftermarket!.id,
        prog: null,
        firm: 'forecast',
        qty: 400,
        due: at(5, 12),
      },
      {
        line: 'DL-1010',
        ref: 'GM-830-1010',
        part: fg2001,
        plant: saltillo!.id,
        cust: gm!.id,
        prog: gmProgram!.id,
        firm: 'firm',
        qty: 450,
        due: at(4, 12),
      },
      // Ramos Arizpe (weld) — ~1740 weld-minutes across 2 cells ≈ 90% of one shift each.
      // Due dates clear the big weld runs (a 9h+ op can't meet a noon due), so Ramos's WELD-CELL
      // baseline is clean. At-risk by design here is TWO orders, telling a two-collision story:
      //  • DL-1006 (Saltillo) — the intended PRIMARY at-risk (due before today's shift opens → late).
      //  • DL-2002 (Ramos) — a DELIBERATE second-order CASCADE: ST-8830 (FG-3001) is gated by the
      //    PV-22 material availability (C2, below), which slips its weld onto +1 and lands its
      //    leak-test on the SHARED, non-splittable Leak-Test Station (C3). ST-8830's inspection then
      //    occupies the station and DL-2002's leak-test op queues behind it past its noon due → late.
      //    DL-2002's own weld finishes a full day early; it is NOT its weld, material, or sequence —
      //    it is the C2 (material) × C3 (inspection-station capacity) INTERACTION made visible. Do not
      //    "fix" DL-2002 by nudging its due date: the cascade is the point. (Confirmed pre-existing;
      //    independent of the warm-start rolling window — see SEED-SCENARIO-SPEC / git-stash test.)
      {
        line: 'ST-8830',
        ref: 'STL-862-8830',
        part: fg3001,
        plant: ramos!.id,
        cust: stellantis!.id,
        prog: stelProgram!.id,
        firm: 'firm',
        qty: 380,
        due: at(0, 20),
      },
      {
        line: 'DL-2002',
        ref: 'STL-862-2002',
        part: fg3002,
        plant: ramos!.id,
        cust: stellantis!.id,
        prog: stelProgram!.id,
        firm: 'firm',
        qty: 340,
        due: at(1, 12),
      },
      {
        line: 'DL-2003',
        ref: 'STL-862-2003',
        part: fg3001,
        plant: ramos!.id,
        cust: stellantis!.id,
        prog: stelProgram!.id,
        firm: 'forecast',
        qty: 250,
        due: at(3, 12),
      },
      {
        line: 'DL-2004',
        ref: 'STL-862-2004',
        part: fg3002,
        plant: ramos!.id,
        cust: stellantis!.id,
        prog: stelProgram!.id,
        firm: 'forecast',
        qty: 200,
        due: at(4, 12),
      },
    ]

    // Month-fill (demo) — load each working day from +2 through the end of THIS month so the
    // board shows scheduled work across the whole month, not just the first few days. The
    // collision spine above (+0/+1) stays the near-term story; this extends the load behind it.
    // Deterministic: one ~full day-load due each working offset (≈ one Saltillo press-day of
    // ~4800 units + one Ramos weld-day of ~1100 units), Sundays skipped (calendar-closed). With
    // ~8 day-loads over the ~8 remaining working days the engine front-loads them back-to-back
    // out to month-end. Quantities stay ≥ the minimum batch (100). Re-anchors on every reset.
    const monthEndOffset = Math.round(
      (Date.UTC(new Date(baseDay).getUTCFullYear(), new Date(baseDay).getUTCMonth() + 1, 0) -
        baseDay) /
        DAY_MS
    )
    const pressParts = [fg2001, fg2002, fg2004]
    const pressCust: [string, string | null][] = [
      [gm!.id, gmProgram!.id],
      [nissan!.id, null],
      [aftermarket!.id, null],
    ]
    // ~75% daily load (leaves slack so the front-loaded plan completes near each day's due
    // date instead of cascading late) and due dates at END of the working day (22:00) — a
    // full day's run can't finish by noon, so a noon due would force structural lateness.
    const pressQtys = [1200, 1150, 1100, 1050] // ≈ 4500 units ≈ ~90% of a Saltillo press-day
    // Weld is non-splittable: a ~750-min job (520 units) fills most of a 960-min day and a second
    // won't fit before 22:00, wasting the evening. Keep weld batches small (~460 min) so TWO pack
    // into a cell-day — restores throughput so non-splittable weld still completes by month-end.
    const weldQtys = [330, 320, 310] // ≈ 960 units/day across 3 smaller, well-packing batches
    let mf = 101
    for (let d = 2; d <= monthEndOffset; d++) {
      if (new Date(baseDay + d * DAY_MS).getUTCDay() === 0) continue // Sunday — calendar-closed
      pressQtys.forEach((qty, i) => {
        const idx = (d + i) % pressParts.length
        const [cust, prog] = pressCust[idx]!
        demand.push({
          line: `MF-${mf}`,
          ref: `MF-${mf}`,
          part: pressParts[idx]!,
          plant: saltillo!.id,
          cust,
          prog,
          firm: i === pressQtys.length - 1 ? 'forecast' : 'firm',
          qty,
          due: at(d, 22),
        })
        mf++
      })
      weldQtys.forEach((qty, i) => {
        demand.push({
          line: `MF-${mf}`,
          ref: `MF-${mf}`,
          part: (d + i) % 2 === 0 ? fg3001 : fg3002,
          plant: ramos!.id,
          cust: stellantis!.id,
          prog: stelProgram!.id,
          firm: i === 1 ? 'forecast' : 'firm',
          qty,
          due: at(d, 22),
        })
        mf++
      })
    }

    // Past-fill (rolling window) — N completed working days BEHIND today, so a fresh reset looks like
    // a running system: real executed production on the board's view-only past-day nav, plus the fuel
    // for learning (Press Line A wear), the wear prediction, and execution OEE. `demo:reset` executes
    // these via the simulator (actuals backdated to each op's planned start, cut off at today); today
    // and the future stay planned. The order-release floor (engine wi-11) pins each past order to its
    // own past day; today/future still front-load from today. Anchored to today → the window rolls
    // forward on every reset. N=10 working days ≈ the 8-sample learning window + margin. Past weld is
    // FG-3002 only (FG-3001's PV-22 gate floors at today 14:00 — it would pull past welds forward).
    const PAST_WORKING_DAYS = 10
    let pf = 9001
    let pastCollected = 0
    for (let d = 1; pastCollected < PAST_WORKING_DAYS && d <= 30; d++) {
      if (new Date(baseDay - d * DAY_MS).getUTCDay() === 0) continue // Sunday — calendar-closed
      pastCollected++
      // Two SMALLER FG-2001 press batches/day → the least-loaded rule splits them across Press A/B,
      // so the wear line (Press A) accrues ~1 op/past-day on ONE routing op = a clean, single-series
      // day-over-day cycle history for the learner. Batches are kept short on purpose: the predictor's
      // cadence = the op's run time, so a shorter op keeps the projected wear-threshold crossing
      // comfortably inside the forecast horizon (a week) → the live, days-out prediction fires. (Wear
      // level is unchanged — sample count drives the trend, not batch size.)
      ;[480, 440].forEach((qty) => {
        demand.push({
          line: `PF-${pf}`,
          ref: `PF-${pf}`,
          part: fg2001,
          plant: saltillo!.id,
          cust: gm!.id,
          prog: gmProgram!.id,
          firm: 'firm',
          qty,
          due: at(-d, 22),
        })
        pf++
      })
      // One FG-3002 weld batch/day → Ramos execution history + OEE, kept LIGHT so the PAST load
      // doesn't itself congest the cells (no material gate on FG-3002). The near-term DL-2002 lateness
      // is the DESIGNED ST-8830 material→leak-test cascade (see the Ramos demand note), not past load.
      demand.push({
        line: `PF-${pf}`,
        ref: `PF-${pf}`,
        part: fg3002,
        plant: ramos!.id,
        cust: stellantis!.id,
        prog: stelProgram!.id,
        firm: 'firm',
        qty: weldQtys[0]!,
        due: at(-d, 22),
      })
      pf++
    }

    await db.insert(demandInput).values(
      demand.map((r) => ({
        tenantId,
        demandLineId: r.line,
        releaseReference: r.ref,
        partId: r.part,
        plantId: r.plant,
        customerId: r.cust,
        programId: r.prog,
        demandType: 'stock' as const,
        firmness: r.firm,
        requiredQty: r.qty,
        uom: 'EA',
        requiredDate: r.due,
      }))
    )
    // Collision-3 — the material gate, live (D36, §4.8). FG-3001 consumes PV-22 (requirement
    // link, BOM-lite); PV-22 isn't available until 14:00 today (availability input). The weld
    // op can't start before then → ST-8830 (FG-3001, due today 20:00) is pushed past close and
    // computed material-at-risk; DL-2003 (FG-3001, due +3) is gated too but has the runway.
    // DESIGNED CASCADE (C2 material × C3 inspection capacity): ST-8830's slipped weld lands its
    // leak-test on the shared, non-splittable Leak-Test Station on +1, where it occupies the station
    // ahead of DL-2002's inspection → DL-2002 tips late. Intended second-order effect; see the Ramos
    // demand note for the full story. (Don't relieve it — the interaction is the demo point.)
    await db
      .insert(materialRequirement)
      .values({
        tenantId,
        plantId: ramos!.id,
        partId: fg3001,
        componentPartId: pv22!.id,
        qtyPerUnit: 1,
      })
    await db
      .insert(materialAvailability)
      .values({
        tenantId,
        plantId: ramos!.id,
        componentPartId: pv22!.id,
        availableAt: at(0, 14),
        qty: 100000,
      })
    // Historical outcomes (phase 5, D57 measured_historical) — representative seed:
    // prior weeks' recorded actuals the baseline arm computes from. Saltillo (plant +
    // Press Line A) and Ramos have history; **Monterrey and Press Line B deliberately
    // have none** → the honest "no historical baseline yet" empty state is testable.
    // A real MES/historian writes the same rows later (source 'mes') with zero change.
    const ho = (
      plantId: string,
      resourceId: string | null,
      start: Date,
      end: Date,
      otif: number,
      costPerUnit: number,
      a: number,
      p: number,
      q: number,
      lateOrders: number,
      throughput: number
    ) => ({
      tenantId,
      plantId,
      resourceId,
      periodStart: start,
      periodEnd: end,
      otif,
      costPerUnit,
      oeeAvailability: a,
      oeePerformance: p,
      oeeQuality: q,
      oee: Number((a * p * q).toFixed(4)),
      lateOrders,
      throughput,
      label: 'representative seed',
      source: 'seed',
    })
    // Measured-historical outcomes — ONE row per scope spanning the trailing Reporting-Policy window.
    // BOTH the cockpit OEE (window-aggregated) and the scorecard's "Historical" VS-BASELINE arm
    // (all-rows-aggregated) read THIS same set, so the historical number is identical on both surfaces
    // (no divergence — #6). Option A "availability-led" story: Press A weak (more changeover/downtime),
    // Press B strong; Saltillo plant blend ~79%. Throughput is weekly units (scaled to the realistically-
    // full demand so live ~thousands/week vs history ~thousands/week). Monterrey & its lines stay absent
    // → the honest "no historical baseline yet" empty state is still testable.
    const [rwS, rwE] = [at(-14), at(0)]
    await db.insert(historicalOutcome).values([
      // cost/unit is a believable pre-platform premium (~12%) over the live Tier-B figure (~$1.8–1.9),
      // so the lift reads realistic (e.g. live $1.82 vs base $2.05), not the old 3–5× (live $1.9 vs $6.30).
      ho(saltillo!.id, null, rwS, rwE, 0.86, 2.05, 0.85, 0.95, 0.98, 2, 23000),
      ho(saltillo!.id, pressA!.id, rwS, rwE, 0.8, 2.15, 0.82, 0.94, 0.985, 2, 11500),
      ho(saltillo!.id, pressB!.id, rwS, rwE, 0.88, 2.0, 0.9, 0.95, 0.985, 1, 12000),
      ho(ramos!.id, null, rwS, rwE, 0.89, 2.15, 0.9, 0.83, 0.976, 1, 5150),
    ])

    // Autonomy config (Config framework, Stage 3 — the `autonomy` group): ADVISORY-FIRST for the
    // demo. A high Tier-1 auto-adopt threshold (a TENANT override) so the warm-start's Press Line A
    // wear PREDICTION stays QUEUED (advisory, "predicting — not yet adopted") instead of auto-pre-
    // adopting (ml_predicted) at reset. Real wear still ADOPTS via the learning rule when actuals
    // cross the band (the live-drift demo's payoff), independent of this gate. The other autonomy
    // fields fall through to the shipped defaults (the config global floor).
    await db.insert(configOverride).values({
      tenantId,
      settingGroup: 'autonomy',
      level: 'tenant',
      scopeId: tenantId,
      payload: { tier1AutoThreshold: 0.97 },
      revision: 1,
    })

    console.log(
      '  ✓ Magna de México scenario: 3 plants, 4 customers, 5 resources, 6 parts, 4 certs, 8 operators, 14 demand lines'
    )
    console.log(
      '  ✓ historical outcomes: 9 rows (Saltillo + Press Line A + Ramos); Monterrey/Press Line B = none (empty-state)'
    )
  }

  console.log(`\nSeed complete. Log in as ${ADMIN_EMAIL} / "${DEFAULT_PASSWORD}".`)
  await pool.end()
}

// CLI entry (`tsx src/db/seed.ts` / `db:seed`) — runs only when invoked directly,
// so importing `seed` from reset.ts doesn't auto-run it.
if (/seed\.ts$/.test(process.argv[1] ?? '')) {
  seed().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
