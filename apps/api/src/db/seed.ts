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
  bom,
  bomComponent,
  certification,
  operator,
  operatorQualification,
  part,
  partPlant,
  plantPartMapping,
  resource,
  resourceGroup,
  resourceGroupMember,
  resourceTypeConfig,
  routing,
  routingOperation,
  uomConversion,
} from '../modules/master-data/schema'
import { contractBinding } from '../modules/binding/schema'
import {
  demandInput,
  historicalOutcome,
  materialAvailability,
  resourceOperatorAssignment,
} from '../modules/scheduling/schema'
import { configOverride, referenceSetOverride } from '../modules/config/schema'

/**
 * Phase-0 seed (install-and-go defaults, D48) + the Magna-Coahuila demo scenario
 * (SEED-SPEC.md). Idempotent. Aggregates every module's schema — like the migration
 * generator, the seed is an explicit, exempt aggregator (api-spec §0 O3). Creates: one
 * tenant, the approval-tier ladder, the seeded editable role set (D33/§3.1), an admin
 * user, and the deterministic, rolling-window demo scenario.
 *
 * Determinism (SEED-SPEC §8 check #9): the builder takes the clock as a parameter
 * (`nowMs`) — NO `Date.now()` inside. `demo:reset` injects one shared clock into both
 * the seed and the simulate step; the CLI `db:seed` falls back to `Date.now()` at the
 * boundary. Every dated row is a pure function of `nowMs` (rolling), except the pinned
 * absolute holiday (Jul 10 2026).
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
 * Seed the deterministic baseline (idempotent). Exported so `demo:reset` (reset.ts) can
 * re-run it after truncating; the CLI entry below runs it for `db:seed`.
 *
 * @param nowMs the injected clock (ms epoch). The rolling window anchors on
 *   `baseDay = startOfDayUtc(nowMs)`. Defaults to `Date.now()` at the CLI boundary;
 *   `demo:reset` passes its own shared clock so seed + simulate agree (no day-boundary race).
 */
export async function seed(nowMs: number = Date.now()): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  const db = drizzle(pool)

  // --- tenant ----------------------------------------------------------------
  // Demo client identity for the shell's brand zone. logoUrl stays null so the
  // OrgAvatar placeholder shows — real logos are tenant-supplied (SKIP-53).
  const DEMO_TENANT = { name: 'Magna International', logoUrl: null as string | null }
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

  // --- Magna-Coahuila scenario (SEED-SPEC.md) --------------------------------
  // ONE coherent, illustrative dataset (an informed guess — NOT Magna's real data)
  // driving all six views + the demo collisions. Every displayed figure computes from
  // these inputs through the real path (no hardcoded outputs). Guarded so a standalone
  // `db:seed` is idempotent; `demo:reset` truncates first.
  const existingPlants = await db.select().from(plant).where(eq(plant.tenantId, tenantId))
  if (existingPlants.length === 0) {
    const DAY_MS = 86_400_000
    const baseDay = Math.floor(nowMs / DAY_MS) * DAY_MS // today 00:00 UTC (injected clock)
    const at = (offsetDays: number, h = 0, m = 0): Date =>
      new Date(baseDay + offsetDays * DAY_MS + h * 3_600_000 + m * 60_000)
    const dowOf = (offsetDays: number): number =>
      new Date(baseDay + offsetDays * DAY_MS).getUTCDay()
    const isWorkday = (offsetDays: number): boolean => {
      const d = dowOf(offsetDays)
      return d >= 1 && d <= 5 // Mon–Fri (SEED-SPEC §4)
    }
    // First working day ≥ today. On the demo day (Mon Jun 29) this is 0; on a weekend rehearsal
    // (the spec requires Jun 27/28 to render too, check #6) it rolls to the next Monday. The
    // collision spine + operator beat anchor here, NOT on the literal `today`, so a Sat/Sun reset
    // doesn't drop the beat onto a closed day (where it would read as structurally late, masking
    // the operator root).
    let wd0 = 0
    while (!isWorkday(wd0)) wd0++

    // === §1 Plants (2 — real Coahuila cities) ===============================
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

    // === §2 Customers (real Magna-Mexico OEMs, coherent per plant) ==========
    const [gm] = await db
      .insert(customer)
      .values({ tenantId, name: 'General Motors', firmFenceDays: 21, priority: 'critical' })
      .returning()
    const [stellantis] = await db
      .insert(customer)
      .values({ tenantId, name: 'Stellantis', firmFenceDays: 18, priority: 'critical' })
      .returning()
    // GM's Ramos Arizpe assembly plant — the JIT/JIS pull next door (the at-risk anchor's customer).
    const [gmRamos] = await db
      .insert(customer)
      .values({ tenantId, name: 'GM Ramos Assembly', firmFenceDays: 7, priority: 'critical' })
      .returning()
    const [vwAudi] = await db
      .insert(customer)
      .values({ tenantId, name: 'VW / Audi', firmFenceDays: 14, priority: 'high' })
      .returning()
    const [progSilverado] = await db
      .insert(program)
      .values({
        tenantId,
        customerId: gm!.id,
        name: 'Silverado / Sierra (T1XX)',
        firmFenceDays: 21,
      })
      .returning()
    const [progRam] = await db
      .insert(program)
      .values({ tenantId, customerId: stellantis!.id, name: 'Ram (DT)', firmFenceDays: 18 })
      .returning()
    const [progBlazer] = await db
      .insert(program)
      .values({ tenantId, customerId: gmRamos!.id, name: 'Blazer / Equinox', firmFenceDays: 7 })
      .returning()
    const [progTiguan] = await db
      .insert(program)
      .values({ tenantId, customerId: vwAudi!.id, name: 'Tiguan / Q-series', firmFenceDays: 14 })
      .returning()

    // === §4 Calendar (2 shifts × 10h = 1,200 min/day; Mon–Fri; Jul 10 holiday) ==
    // Regular window 00:00–20:00 (1,200 min); 20:00→24:00 = 4h same-day OT headroom
    // (SEED-SPEC §4). The OT cap (resourceTypeConfig.otCapMinutes = 240) spends that gap.
    // Holiday PINNED to the absolute date (SEED-SPEC §4b) — both plants closed Fri Jul 10 2026.
    const shifts = {
      shiftPatterns: [
        { name: 'A', start: '00:00', end: '10:00' },
        { name: 'B', start: '10:00', end: '20:00' },
      ],
      holidays: ['2026-07-10'],
      workingDays: [1, 2, 3, 4, 5],
    }
    const [calSaltillo] = await db
      .insert(calendar)
      .values({ tenantId, plantId: saltillo!.id, name: 'Saltillo two-shift', ...shifts })
      .returning()
    const [calRamos] = await db
      .insert(calendar)
      .values({ tenantId, plantId: ramos!.id, name: 'Ramos Arizpe two-shift', ...shifts })
      .returning()

    // === Resources + Tier-B cost rates (Master-Data-owned; scheduling computes cost/unit) ==
    // NOTE: the wear line keeps the name 'Press Line A' — reset.ts binds the simulator drift
    // to that exact name. Display shorthand "Press A" / "Press B" lives in the spec; the rows
    // stay 'Press Line A/B', 'Weld Cell 1/2', 'Leak-Test Station'.
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
    // Shared finite leak-test station — every welded part passes through after welding (routing
    // op 20 → this group). One station = hard capacity; welds finishing close together queue.
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
    // Resource-type shift config (D-shift): presses + weld cells non-splittable, up to 4h/day OT
    // (the ceiling the what-if "overtime" option spends; a normal solve uses none). The leak
    // work-centre runs in-shift (no OT). minBatchQty set below every seeded demand qty (smallest
    // ~45) so it never binds by default — real + configurable, proven via the launcher.
    await db.insert(resourceTypeConfig).values([
      { tenantId, resourceType: 'line', splittable: false, otCapMinutes: 240, minBatchQty: 40 },
      { tenantId, resourceType: 'cell', splittable: false, otCapMinutes: 240, minBatchQty: 30 },
      { tenantId, resourceType: 'work_center', splittable: false, otCapMinutes: 0, minBatchQty: 0 },
    ])

    // Resource groups — presses are SINGLE-resource groups so each part pins to its press
    // (SEED-SPEC §3: SAL parts are Press-A or Press-B specific), giving direct per-press util
    // control. Weld cells share ONE group {Cell 1, Cell 2} so RAM-2001/2002 are routable on both
    // (the line-down reroute target); the least-loaded rule balances the two cells.
    const [pressAGrp] = await db
      .insert(resourceGroup)
      .values({ tenantId, name: 'Press A', plantId: saltillo!.id })
      .returning()
    const [pressBGrp] = await db
      .insert(resourceGroup)
      .values({ tenantId, name: 'Press B', plantId: saltillo!.id })
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
      { tenantId, resourceGroupId: pressAGrp!.id, resourceId: pressA!.id },
      { tenantId, resourceGroupId: pressBGrp!.id, resourceId: pressB!.id },
      { tenantId, resourceGroupId: weldGrp!.id, resourceId: weld1!.id },
      { tenantId, resourceGroupId: weldGrp!.id, resourceId: weld2!.id },
      { tenantId, resourceGroupId: leakGrp!.id, resourceId: leakStation!.id },
    ])

    // === §3 Parts (10 finished + 1 purchased component for the material gate) =====
    // Layer 0: routing/demand/material reference parts by the durable `part_no`, so track id → part_no
    // as parts are created and resolve the business key at each downstream insert.
    const partNoOf = new Map<string, string>()
    const mkPart = async (v: {
      partNo: string
      description: string
      material: string
      gauge: string
      colour?: string
      partType?: 'finished' | 'component'
      // Layer 1: authoritative sourcing flag (no DB default — must be stated). Defaults to 'make'; the
      // seeded buy-component (the coil) passes 'buy' to match the material_requirement backfill.
      makeBuy?: 'make' | 'buy'
      // Layer 1 §4C: extensible custom-attribute map (MD12); one part carries it to exercise the
      // per-plant shared_attributes key-merge (§4E). Not read by the sequencer.
      sharedAttributes?: Record<string, unknown>
    }): Promise<string> => {
      const id = (
        await db
          .insert(part)
          .values({ tenantId, partType: 'finished', uom: 'EA', colour: null, makeBuy: 'make', ...v })
          .returning()
      )[0]!.id
      partNoOf.set(id, v.partNo)
      return id
    }
    // Saltillo (6) — stampings (presses). colour drives the press changeover attribute.
    const sal1001 = await mkPart({
      partNo: 'SAL-1001',
      description: 'Body-side outer panel, LH',
      material: 'Steel HSLA',
      gauge: '1.4mm',
      colour: 'Bare',
      // Global custom attributes — the Saltillo part_plant override (§4E, below) merges over these.
      sharedAttributes: { finish: 'standard', tolerance: '0.10mm' },
    })
    const sal1002 = await mkPart({
      partNo: 'SAL-1002',
      description: 'Roof bow reinforcement',
      material: 'Steel HSLA',
      gauge: '1.2mm',
      colour: 'Bare',
    })
    const sal1003 = await mkPart({
      partNo: 'SAL-1003',
      description: 'Floor pan cross-member',
      material: 'Steel',
      gauge: '1.5mm',
      colour: 'Zinc',
    })
    const sal1004 = await mkPart({
      partNo: 'SAL-1004',
      description: 'Underbody rail, RH',
      material: 'Steel HSLA',
      gauge: '1.8mm',
      colour: 'Zinc',
    })
    const sal1005 = await mkPart({
      partNo: 'SAL-1005',
      description: 'Shock-tower bracket',
      material: 'Steel',
      gauge: '2.0mm',
      colour: 'Zinc',
    })
    const sal1006 = await mkPart({
      partNo: 'SAL-1006',
      description: 'Hood inner panel',
      material: 'Steel',
      gauge: '1.0mm',
      colour: 'Bare',
    })
    // Ramos (4) — weldments. material drives the weld changeover attribute.
    const ram2001 = await mkPart({
      partNo: 'RAM-2001',
      description: 'Front structure weldment, LH',
      material: 'Steel',
      gauge: '2.0mm',
    })
    const ram2002 = await mkPart({
      partNo: 'RAM-2002',
      description: 'Rear floor weldment',
      material: 'Steel',
      gauge: '1.8mm',
    })
    const ram2003 = await mkPart({
      partNo: 'RAM-2003',
      description: 'Cross-car beam sub-assembly',
      material: 'Steel HSLA',
      gauge: '2.2mm',
    })
    const ram2004 = await mkPart({
      partNo: 'RAM-2004',
      description: 'Suspension cradle weldment',
      material: 'Steel HSLA',
      gauge: '2.5mm',
    })
    // Purchased steel-coil component for SAL-1004's material gate (the honest-no beat wires its
    // late availability post-checkpoint; the part exists in the foundation).
    const coil = await mkPart({
      partNo: 'COIL-HSLA-18',
      description: 'HSLA steel coil 1.8mm (purchased) — SAL-1004 material gate',
      material: 'Steel HSLA',
      gauge: '1.8mm',
      partType: 'component',
      makeBuy: 'buy', // the one buy-component (matches the material_requirement backfill → 'buy')
    })

    // === Layer 1 §4B/§4D/§4E master-data extensions ============================
    // Additive reference/override data; the sequencer never reads it (consumers resolve the global
    // part via `resolvePart` WITHOUT a plantId), so the demo schedule is unchanged. Idempotent by
    // virtue of the whole seed running only on an empty tenant (reset truncates first).
    //
    // One UoM factor on the purchased coil (§4B): 1 COIL = 500 EA (base_uom = the version's uom, EA).
    // `factor` is the numeric column's native decimal STRING (no global OID-1700 parser).
    await db.insert(uomConversion).values({
      tenantId,
      partId: coil,
      alternateUom: 'COIL',
      baseUom: 'EA',
      factor: '500',
    })
    // One plant-local alias per plant (§4D / MD9) → global part_no (resolvePlantPart).
    await db.insert(plantPartMapping).values([
      { tenantId, plantId: saltillo!.id, plantPartNo: 'STL-BODY-LH', partNo: 'SAL-1001' },
      { tenantId, plantId: ramos!.id, plantPartNo: 'RMS-FRONT-LH', partNo: 'RAM-2001' },
    ])
    // One per-plant override (§4E) on SAL-1001 at Saltillo — exercises BOTH resolution rules:
    //  • named fields prefer-plant-else-global: colour overridden ('Painted'); material/gauge left
    //    null → inherit the global part version.
    //  • shared_attributes shallow key-merge over the part's global map { finish:'standard',
    //    tolerance:'0.10mm' } → { finish:'premium' (override), tolerance:'0.10mm' (retained),
    //    line:'A' (plant-only key added) }.
    await db.insert(partPlant).values({
      tenantId,
      partNo: 'SAL-1001',
      plantId: saltillo!.id,
      colour: 'Painted',
      sharedAttributes: { finish: 'premium', line: 'A' },
    })

    // === Routings (std times = the `standard` baseline, D7) =====================
    // Stamping: cycle ~0.75 min/part (~45 s), setup ~20 min. Welding: cycle ~3 min/assembly,
    // setup ~15 min. Leak: cycle ~1.4 min/part, setup ~5 min (the inspection tail, opSeq 20).
    type ChangeoverKey = 'colour' | 'material' | 'gauge' | null
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
        .values({ tenantId, partNo: partNoOf.get(partId)!, name, isPrimary: true })
        .returning()
      await db.insert(routingOperation).values({
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
    const mkInspection = async (routingId: string): Promise<void> => {
      await db.insert(routingOperation).values({
        tenantId,
        routingId,
        opSeq: 20,
        resourceGroupId: leakGrp!.id,
        stdSetupTime: 5,
        stdCycleTime: 1.4,
        changeoverAttributeKey: null,
      })
    }
    await mkRouting(sal1001, 'SAL-1001 primary', pressAGrp!.id, 20, 0.75, 'colour')
    await mkRouting(sal1002, 'SAL-1002 primary', pressAGrp!.id, 20, 0.75, 'colour')
    await mkRouting(sal1006, 'SAL-1006 primary', pressAGrp!.id, 20, 0.75, 'colour')
    await mkRouting(sal1003, 'SAL-1003 primary', pressBGrp!.id, 20, 0.75, 'colour')
    await mkRouting(sal1004, 'SAL-1004 primary', pressBGrp!.id, 22, 0.78, 'colour')
    await mkRouting(sal1005, 'SAL-1005 primary', pressBGrp!.id, 20, 0.75, 'colour')
    const rt2001 = await mkRouting(ram2001, 'RAM-2001 primary', weldGrp!.id, 15, 3.0, 'material')
    const rt2002 = await mkRouting(ram2002, 'RAM-2002 primary', weldGrp!.id, 15, 3.0, 'material')
    const rt2003 = await mkRouting(ram2003, 'RAM-2003 primary', weldGrp!.id, 16, 3.1, 'material')
    const rt2004 = await mkRouting(ram2004, 'RAM-2004 primary', weldGrp!.id, 16, 3.2, 'material')
    await mkInspection(rt2001)
    await mkInspection(rt2002)
    await mkInspection(rt2003)
    await mkInspection(rt2004)

    // === Certifications + operators (Workforce View 3) =========================
    const mkCert = async (code: string, name: string, description: string): Promise<string> =>
      (await db.insert(certification).values({ tenantId, code, name, description }).returning())[0]!
        .id
    const certLeak = await mkCert('LEAK', 'Leak test', 'Leak-test station qualification')
    const certTorque = await mkCert('TORQUE', 'Torque-critical', 'Torque-critical fastening')
    const certCmm = await mkCert('CMM', 'CMM inspection', 'Coordinate-measuring inspection')
    const certWeld = await mkCert('WELD', 'Weld certification', 'MIG / spot weld qualification')

    // §4b Roster — most operators ~1.00 so the plant runs normally; Ana is the deliberate slow
    // outlier (operator beat) and Mateo the faster-pricier remediation lever. performanceFactor =
    // percent-of-standard (higher = faster); the engine divides run time by it.
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
    // Saltillo (5 active)
    const ana = await mkOp('Ana Reyes', saltillo!.id, true, 28.0, 0.3) // operator beat — slow on SAL-1002
    const mateo = await mkOp('Mateo Ríos', saltillo!.id, true, 31.5, 1.05) // faster-pricier lever (present, unassigned)
    const carlos = await mkOp('Carlos Méndez', saltillo!.id, true, 28.0, 1.0) // Press A standard baseline
    const sofia = await mkOp('Sofía Torres', saltillo!.id, true, 28.0, 1.0) // Press B
    const diego = await mkOp('Diego Ramírez', saltillo!.id, true, 27.0, 0.98) // Press B 2nd shift
    // Ramos (5 active)
    const lucia = await mkOp('Lucía Fernández', ramos!.id, true, 26.0, 1.0) // Weld Cell 1
    const javier = await mkOp('Javier Morales', ramos!.id, true, 26.0, 1.0) // Weld Cell 1 2nd shift
    const valentina = await mkOp('Valentina Cruz', ramos!.id, true, 26.0, 1.0) // Weld Cell 2
    const andres = await mkOp('Andrés Vargas', ramos!.id, true, 25.0, 0.97) // Weld Cell 2 2nd shift
    const camila = await mkOp('Camila Reyes', ramos!.id, true, 24.0, 1.0) // Leak-Test
    // OUT this window (§4b) — in the master pool but NOT in the available roster: the roster
    // boundary (who's present is external/fed-in; the scheduler allocates the present crew).
    await mkOp('Fernando Castro', saltillo!.id, false, 28.0, 1.0, 'vacation') // Press A short a body
    await mkOp('Patricia Gómez', ramos!.id, false, 26.0, 1.0, 'sick')
    await mkOp('Roberto Salinas', saltillo!.id, false, 28.0, 1.0, 'not_scheduled')
    await db.insert(operatorQualification).values([
      { tenantId, operatorId: ana, certificationId: certTorque },
      { tenantId, operatorId: mateo, certificationId: certTorque },
      { tenantId, operatorId: carlos, certificationId: certTorque },
      { tenantId, operatorId: sofia, certificationId: certTorque },
      { tenantId, operatorId: diego, certificationId: certTorque },
      { tenantId, operatorId: lucia, certificationId: certWeld },
      { tenantId, operatorId: javier, certificationId: certWeld },
      { tenantId, operatorId: valentina, certificationId: certWeld },
      { tenantId, operatorId: andres, certificationId: certWeld },
      { tenantId, operatorId: camila, certificationId: certLeak },
      { tenantId, operatorId: camila, certificationId: certCmm },
    ])

    // Operator → resource assignments (C5). The KEY mechanism for the operator beat
    // (SEED-SPEC §7/§9): Carlos covers Press A open-ended at STANDARD (1.00) so the Press A
    // baseline runs normally and stays at its 85% std util. Ana (0.30) gets a NARROW day-0
    // window [today 00:00, today 10:00); the resolver picks the latest-`effectiveFrom`
    // assignment, so Ana WINS only for the op that starts at the day-0 origin — SAL-1002, the
    // tightest-due Press A order. Every later Press A op (and all past Press A ops) falls
    // outside the window → Carlos → standard. So Ana inflates ONLY SAL-1002, never the whole
    // line — the precise condition that roots SAL-1002 at `operator`, not `capacity`.
    await db.insert(resourceOperatorAssignment).values([
      {
        tenantId,
        plantId: saltillo!.id,
        resourceId: pressA!.id,
        operatorId: carlos,
        effectiveFrom: null,
        effectiveTo: null,
      },
      // Ana's window spans today 00:00 → first-working-day 10:00. The engine resolves the operator
      // at the placement FLOOR (= today's origin, possibly a weekend); the legibility card resolves
      // at the placed START (the first working day). Covering both keeps them in agreement, and only
      // SAL-1002 (the op starting at wd0 00:00) falls inside — every later Press A op starts after
      // its ~18:20 finish, past the 10:00 window close.
      {
        tenantId,
        plantId: saltillo!.id,
        resourceId: pressA!.id,
        operatorId: ana,
        effectiveFrom: at(0, 0, 0),
        effectiveTo: at(wd0, 10, 0),
      },
      {
        tenantId,
        plantId: saltillo!.id,
        resourceId: pressB!.id,
        operatorId: sofia,
        effectiveFrom: null,
        effectiveTo: null,
      },
      {
        tenantId,
        plantId: ramos!.id,
        resourceId: weld1!.id,
        operatorId: lucia,
        effectiveFrom: null,
        effectiveTo: null,
      },
      {
        tenantId,
        plantId: ramos!.id,
        resourceId: weld2!.id,
        operatorId: valentina,
        effectiveFrom: null,
        effectiveTo: null,
      },
      {
        tenantId,
        plantId: ramos!.id,
        resourceId: leakStation!.id,
        operatorId: camila,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ])

    // binding: the platform_module counterparts (per-tenant, O7)
    await db.insert(contractBinding).values([
      { tenantId, contractId: 'masterdata.read', major: '1', mode: 'platform_module' },
      { tenantId, contractId: 'reference.read', major: '1', mode: 'platform_module' },
      { tenantId, contractId: 'bom.read', major: '1', mode: 'platform_module' },
      { tenantId, contractId: 'asset.read', major: '1', mode: 'platform_module' },
    ])

    // === §5 Demand — back-solved to the utilization targets (rolling window) ====
    // Available regular = 1,200 min/day × 5 = 6,000 min/wk per resource. Targets: Press A 85%,
    // Press B 70%, weld cells ~74% (combined; the least-loaded rule equalizes them), leak ~67%.
    // Many small orders (~165 min). Due at end-of-day (20:00) so a front-loaded day meets it →
    // baseline opens HEALTHY (no standing at-risk except the seeded operator beat). Past 15 +
    // future 15 working days (≈ 3 weeks each side, SEED-SPEC §6). All offsets relative to today.
    type Firmness = 'firm' | 'forecast'
    type DemandRow = {
      line: string
      part: string
      plant: string
      cust: string
      prog: string | null
      firm: Firmness
      qty: number
      due: Date
    }
    const demand: DemandRow[] = []
    let seq = 1000
    const push = (r: Omit<DemandRow, 'line'>): void => {
      const line = `D-${seq}`
      demand.push({ line, ...r })
      seq++
    }
    // Historical OTIF misses are seeded as EXECUTION late-finishes in the simulator (a thin slice of
    // past orders finished after their due) — NOT as plan changes — so the committed plan (and its
    // live at-risk spine) is untouched. See `injectMisses` in reset.ts / simulator.service.ts.

    // Per-day order templates (qty lists sum to the daily busy-minute target at std times).
    // Press A baseline = SAL-1001 / SAL-1006 (SAL-1002 is reserved for the operator beat).
    const pressARot = [sal1001, sal1006]
    const pressAQtys = [210, 200, 195, 205, 190, 200] // 6 orders ≈ 1,020 min ≈ 85%
    // Press B baseline = SAL-1003 / SAL-1005 (SAL-1004 carries the material-gate beat post-checkpoint).
    const pressBRot = [sal1003, sal1005]
    const pressBQtys = [205, 195, 200, 190, 210] // 5 orders ≈ 850 min ≈ 71%
    // Welds — RAM-2001/2002 (GM-Ramos JIT) + RAM-2003/2004 (VW/Audi). 9 orders/day across both
    // cells ≈ 1,750 min ≈ 73% per cell; their leak tails ≈ 67% on the station.
    const weldRot = [
      { part: ram2001, cust: gmRamos!.id, prog: progBlazer!.id },
      { part: ram2002, cust: gmRamos!.id, prog: progBlazer!.id },
      { part: ram2003, cust: vwAudi!.id, prog: progTiguan!.id },
      { part: ram2004, cust: vwAudi!.id, prog: progTiguan!.id },
    ]
    // 12 orders/day across both cells ≈ 1,800 min ⇒ ~75% per cell (least-loaded equalizes them);
    // their leak tails ≈ 67% on the shared station. (RG: bump volume, accept ~equal cells.)
    const weldQtys = [48, 42, 46, 44, 40, 48, 44, 46, 42, 48, 44, 46]

    // Generate baseline for each working day in [-15 working days, +15 working days]. Day 0
    // (today) carries the operator beat (below) + the Ramos/Press-B baseline; Press A day-0
    // baseline is intentionally SKIPPED so SAL-1002's inflated run has the line to itself (no
    // stray firm at-risk from the hog).
    const collectWorkingOffsets = (from: number, to: number): number[] => {
      const out: number[] = []
      for (let d = from; d <= to; d++) if (isWorkday(d)) out.push(d)
      return out
    }
    const pastOffsets = collectWorkingOffsets(-23, -1).slice(-15) // last 15 working days before today
    const futureOffsets = collectWorkingOffsets(0, 23).slice(0, 15) // today + first 14 working days ahead
    const allOffsets = [...pastOffsets, ...futureOffsets]

    // Standing-beat day offsets (working-day grain, SEED-SPEC §7). Computed before the baseline loop
    // so each beat's line is lightened on its day — the inflated/gated beat order has room and
    // doesn't strand the day's baseline behind it (the operator-beat lesson, generalized).
    const OP_DUE_OFFSET = wd0 // operator beat (Press A), today/first working day
    const MAT_DUE_OFFSET = futureOffsets[2] ?? futureOffsets[futureOffsets.length - 1]! // material (Press B), ~+2 working days
    const ANCHOR_DUE_OFFSET = futureOffsets[1] ?? futureOffsets[0]! // at-risk anchor (Ramos), +1 working day

    let dayIdx = 0
    for (const d of allOffsets) {
      // Press A baseline (skip the operator-beat day — SAL-1002's inflated run has the line to itself)
      if (d !== OP_DUE_OFFSET) {
        pressAQtys.forEach((qty, i) => {
          const partId = pressARot[(dayIdx + i) % pressARot.length]!
          push({
            part: partId,
            plant: saltillo!.id,
            cust: gm!.id,
            prog: progSilverado!.id,
            firm: i >= pressAQtys.length - 1 ? 'forecast' : 'firm',
            qty,
            due: at(d, 20),
          })
        })
      }
      // Press B baseline (skip the material-beat day — SAL-1004's coil-gated afternoon run would
      // otherwise saturate Press B and strand the day's baseline behind it)
      if (d !== MAT_DUE_OFFSET) {
        pressBQtys.forEach((qty, i) => {
          const partId = pressBRot[(dayIdx + i) % pressBRot.length]!
          // SAL-1003 → GM (Silverado); SAL-1005 → Stellantis (Ram) — per §3.
          const isGm = partId === sal1003
          push({
            part: partId,
            plant: saltillo!.id,
            cust: isGm ? gm!.id : stellantis!.id,
            prog: isGm ? progSilverado!.id : progRam!.id,
            firm: i >= pressBQtys.length - 1 ? 'forecast' : 'firm',
            qty,
            due: at(d, 20),
          })
        })
      }
      // Welds
      weldQtys.forEach((qty, i) => {
        const w = weldRot[(dayIdx + i) % weldRot.length]!
        push({
          part: w.part,
          plant: ramos!.id,
          cust: w.cust,
          prog: w.prog,
          firm: i >= weldQtys.length - 2 ? 'forecast' : 'firm',
          qty,
          due: at(d, 20),
        })
      })
      dayIdx++
    }

    // --- §7 Operator beat (SEED-SPEC §7/§9) ---------------------------------
    // SAL-1002 (firm, GM, Press A). Tight due TODAY evening. At STANDARD it runs ~344 min and
    // finishes early on-time; under Ana (0.30) the run inflates ~3.33× to ~1,100 min, fits the
    // day's window (bounded — no overflow hog) but finishes ~18:20, PAST the 17:00 due → at-risk.
    // Counterfactual at standard is on-time → roots at `operator` (Ana), naming her + her 30%.
    // qty 432 sets std run ≈ 20 + 0.75·432 = 344 min; inflated ≈ 20 + 2.5·432 = 1,100 min.
    const OP_BEAT_QTY = 432
    push({
      part: sal1002,
      plant: saltillo!.id,
      cust: gm!.id,
      prog: progSilverado!.id,
      firm: 'firm',
      qty: OP_BEAT_QTY,
      due: at(wd0, 17),
    })

    // --- §7 Material honest-no beat (SEED-SPEC §7) ---------------------------
    // SAL-1004 (firm, Stellantis, Press B). Its HSLA coil isn't available until the due-day
    // AFTERNOON (materialAvailability below). The op's start floors on that arrival (material gate,
    // D36), so the finish lands AFTER the due — and OT can't pull it earlier (OT extends the day's
    // END, not the gated START). Goal-seek therefore returns UNACHIEVABLE attributed to `material`
    // ("expedite / re-promise," not capacity). due ~+2 working days (Wed), per §7. MAT_DUE_OFFSET
    // is computed above the baseline loop (Press B is lightened on that day).
    const MAT_QTY = 420
    push({
      part: sal1004,
      plant: saltillo!.id,
      cust: stellantis!.id,
      prog: progRam!.id,
      firm: 'firm',
      qty: MAT_QTY,
      due: at(MAT_DUE_OFFSET, 18),
    })

    // --- §7 At-risk anchor (SEED-SPEC §7) ------------------------------------
    // RAM-2001 (firm, GM-Ramos JIT). A tight sequenced pull due +1 working day midday: on the
    // HEALTHY baseline it finishes on-time but with ~no slack; under perturbation (line-down /
    // demand-change) it tips at-risk → the two-door remediation target. Kept on-time at reset
    // (check #5/#10) — the perturbation is the injected beat, not a standing catastrophe.
    // ANCHOR_DUE_OFFSET is computed above the baseline loop.
    const ANCHOR_QTY = 55
    // Due tight (early +1d): the JIT pull is placed first among Ramos work and finishes ~04:20, so a
    // 06:30 due leaves ~2h slack — on-time on the healthy baseline, but a modest line-down / demand
    // bump tips it at-risk. (If a reset ever shows it at-risk at baseline, loosen toward midday.)
    push({
      part: ram2001,
      plant: ramos!.id,
      cust: gmRamos!.id,
      prog: progBlazer!.id,
      firm: 'firm',
      qty: ANCHOR_QTY,
      due: at(ANCHOR_DUE_OFFSET, 6, 30),
    })

    await db.insert(demandInput).values(
      demand.map((r) => ({
        tenantId,
        demandLineId: r.line,
        releaseReference: r.line,
        partNo: partNoOf.get(r.part)!,
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

    // Material gate wiring for the SAL-1004 honest-no beat (D36): SAL-1004 consumes the HSLA coil, now
    // expressed as a real master-data BOM (D-L2-4 — the interim material_requirement is retired). One
    // published, open BOM version (effective well before the window so it resolves at every build asOf)
    // whose single edge → the coil buy-leaf. The gate explodes this → COIL-HSLA-18 (buy) → the coil isn't
    // on hand until the due-day 14:00, so the Press-B op can't start before then → finish slips past the
    // 18:00 due, and OT can't recover the gated start. Same buy-leaf the interim table produced.
    const [sal1004Bom] = await db
      .insert(bom)
      .values({ tenantId, parentPartNo: partNoOf.get(sal1004)!, revision: 'A', status: 'published', effectiveFrom: at(-30), effectiveTo: null })
      .returning()
    await db.insert(bomComponent).values({ tenantId, bomId: sal1004Bom!.id, componentPartNo: partNoOf.get(coil)!, qtyPer: '1' })
    await db.insert(materialAvailability).values({
      tenantId,
      plantId: saltillo!.id,
      componentPartNo: partNoOf.get(coil)!,
      availableAt: at(MAT_DUE_OFFSET, 14),
      qty: 1_000_000,
    })

    // === Historical outcomes (D57 measured_historical) — representative seed =====
    // Prior weeks' recorded actuals the VS-Baseline (measured_historical) arm computes from — one row
    // per PLANT and per producing LANE, so the Scorecard's "VS Baseline" shows numbers for every lane
    // selection (Press A/B, both weld cells, Leak-Test), not just the plant. A real MES/historian
    // writes the same rows later (source 'mes'). The plant-level scope averages its plant row + lane
    // rows; the line values are chosen so each plant blends to its plant-level figure.
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
    const [rwS, rwE] = [at(-14), at(0)]
    await db
      .insert(historicalOutcome)
      .values([
        // Saltillo: plant + both press lines (Press A weaker, Press B stronger → plant blends ~0.86).
        ho(saltillo!.id, null, rwS, rwE, 0.86, 2.05, 0.85, 0.95, 0.98, 2, 23000),
        ho(saltillo!.id, pressA!.id, rwS, rwE, 0.8, 2.15, 0.82, 0.94, 0.985, 2, 11500),
        ho(saltillo!.id, pressB!.id, rwS, rwE, 0.92, 1.95, 0.91, 0.95, 0.985, 0, 12000),
        // Ramos: plant + both weld cells + the shared leak-test station.
        ho(ramos!.id, null, rwS, rwE, 0.89, 2.15, 0.9, 0.83, 0.976, 1, 5150),
        ho(ramos!.id, weld1!.id, rwS, rwE, 0.88, 2.18, 0.89, 0.82, 0.974, 1, 2200),
        ho(ramos!.id, weld2!.id, rwS, rwE, 0.9, 2.12, 0.91, 0.84, 0.978, 0, 2200),
        ho(ramos!.id, leakStation!.id, rwS, rwE, 0.91, 1.2, 0.93, 0.86, 0.985, 0, 5150),
      ])

    // === Autonomy config — TIER-1 AUTO-ADOPT AT 0.85 (a TENANT override) =========
    // The gate auto-commits a Tier-1 wear prediction once confidence ≥ this. At 0.85 the warm-start
    // shows BOTH ends of the autonomy gradient at reset, deterministically:
    //   • Press Line A — conf ~0.67 (crossing ~2 days out) → stays QUEUED ("predicting, awaiting you").
    //   • Press Line B — worn nearer end-of-life, conf ~0.88 (crossing ~8 h out) → AUTO-COMMITTED: the
    //     ml_predicted overlay is pre-adopted for the next solve and the Exception Queue shows it
    //     auto-handled. (0.88 is about the ceiling for a not-yet-crossed lane — steeper and the newest
    //     actual crosses the band, at which point the learning rule ADOPTS instead, the live-drift payoff.)
    // Other autonomy fields fall through to the shipped floor.
    await db.insert(configOverride).values({
      tenantId,
      settingGroup: 'autonomy',
      level: 'tenant',
      scopeId: tenantId,
      payload: { tier1AutoThreshold: 0.85 },
      revision: 1,
    })

    // Reference-set demo (test-only `__test_refset`, NO asset_type): a tenant-level override that
    // exercises the fold end-to-end through a real reset — ADDS a member ('d') and SUPPRESSES an
    // inherited platform default ('c') via a tombstone. Resolves platform [a,b,c] → tenant → [a,b,d].
    await db.insert(referenceSetOverride).values({
      tenantId,
      setKey: '__test_refset',
      level: 'tenant',
      scopeId: tenantId,
      payload: { members: { d: { label: 'Delta (tenant)' } }, tombstones: ['c'] },
      revision: 1,
    })

    console.log(
      `  ✓ Magna-Coahuila scenario: 2 plants, 4 customers, 5 resources, 10 parts (+1 component), 4 certs, 13 operators (10 active + 3 out), ${demand.length} demand lines`
    )
    console.log(
      '  ✓ operator beat: SAL-1002 (Ana 30%, narrow day-0 window) — verify it roots `operator`'
    )
    console.log(
      '  ✓ historical outcomes: 7 rows (2 plants + every producing lane — VS-Baseline shows per-lane)'
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
