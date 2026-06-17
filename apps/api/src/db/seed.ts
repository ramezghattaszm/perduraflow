import * as bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import { tenant } from '../modules/tenant/schema'
import { approvalTier, role, user } from '../modules/auth/schema'
import { calendar, customer, plant, plantGroup, plantGroupMember, program } from '../modules/org/schema'
import {
  certification,
  operator,
  operatorQualification,
  part,
  resource,
  resourceGroup,
  resourceGroupMember,
  routing,
  routingOperation,
} from '../modules/master-data/schema'
import { contractBinding } from '../modules/binding/schema'
import { demandInput, historicalOutcome } from '../modules/scheduling/schema'

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
  if (existingTenant) await db.update(tenant).set(DEMO_TENANT).where(eq(tenant.id, existingTenant.id))
  const tenantId = tenantRow!.id
  console.log(`  ✓ tenant: ${tenantId}`)

  // --- approval tiers --------------------------------------------------------
  const tierIdByName = new Map<string, string>()
  const existingTiers = await db.select().from(approvalTier).where(eq(approvalTier.tenantId, tenantId))
  for (const t of SEED_TIERS) {
    const found = existingTiers.find((r) => r.name === t.name)
    if (found) {
      tierIdByName.set(t.name, found.id)
    } else {
      const [created] = await db.insert(approvalTier).values({ tenantId, name: t.name, rank: t.rank }).returning()
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
    const [saltillo] = await db.insert(plant).values({ tenantId, name: 'Saltillo Stamping', timezone: 'America/Mexico_City', region: 'Coahuila' }).returning()
    const [ramos] = await db.insert(plant).values({ tenantId, name: 'Ramos Arizpe Welding', timezone: 'America/Mexico_City', region: 'Coahuila' }).returning()
    await db.insert(plant).values({ tenantId, name: 'Monterrey Components', timezone: 'America/Monterrey', region: 'Nuevo León' })
    const [cluster] = await db.insert(plantGroup).values({ tenantId, name: 'Coahuila cluster', groupType: 'cluster', allowsResourceSharing: true }).returning()
    await db.insert(plantGroupMember).values([
      { tenantId, plantGroupId: cluster!.id, plantId: saltillo!.id },
      { tenantId, plantGroupId: cluster!.id, plantId: ramos!.id },
    ])

    // customers (priority tiers — View 5; priority set on insert) + programs
    const [gm] = await db.insert(customer).values({ tenantId, name: 'General Motors', firmFenceDays: 14, priority: 'critical' }).returning()
    const [stellantis] = await db.insert(customer).values({ tenantId, name: 'Stellantis', firmFenceDays: 14, priority: 'critical' }).returning()
    const [nissan] = await db.insert(customer).values({ tenantId, name: 'Nissan Mexicana', firmFenceDays: 10, priority: 'high' }).returning()
    const [aftermarket] = await db.insert(customer).values({ tenantId, name: 'Aftermarket / Service Parts', firmFenceDays: 7, priority: 'standard' }).returning()
    const [gmProgram] = await db.insert(program).values({ tenantId, customerId: gm!.id, name: 'Silverado/Sierra body', firmFenceDays: 21 }).returning()
    const [stelProgram] = await db.insert(program).values({ tenantId, customerId: stellantis!.id, name: 'RAM 1500 underbody', firmFenceDays: 18 }).returning()

    // calendars — one standard two-shift pattern per producing plant
    const shifts = { shiftPatterns: [{ name: 'A', start: '06:00', end: '14:00' }, { name: 'B', start: '14:00', end: '22:00' }], holidays: [], maintenanceWindows: [] }
    const [calSaltillo] = await db.insert(calendar).values({ tenantId, plantId: saltillo!.id, name: 'Saltillo two-shift', ...shifts }).returning()
    const [calRamos] = await db.insert(calendar).values({ tenantId, plantId: ramos!.id, name: 'Ramos Arizpe two-shift', ...shifts }).returning()

    // resources + Tier-B cost rates (Master-Data-owned; scheduling computes cost/unit)
    const [pressA] = await db.insert(resource).values({ tenantId, name: 'Press Line A', resourceType: 'line', plantId: saltillo!.id, calendarId: calSaltillo!.id, rate: 12, rateUom: 'strokes/min', runCostPerHour: 145, setupCost: 130, overheadPerUnit: 0.65 }).returning()
    const [pressB] = await db.insert(resource).values({ tenantId, name: 'Press Line B', resourceType: 'line', plantId: saltillo!.id, calendarId: calSaltillo!.id, rate: 11, rateUom: 'strokes/min', runCostPerHour: 140, setupCost: 125, overheadPerUnit: 0.6 }).returning()
    const [weld1] = await db.insert(resource).values({ tenantId, name: 'Weld Cell 1', resourceType: 'cell', plantId: ramos!.id, calendarId: calRamos!.id, runCostPerHour: 98, setupCost: 75, overheadPerUnit: 0.48 }).returning()
    const [weld2] = await db.insert(resource).values({ tenantId, name: 'Weld Cell 2', resourceType: 'cell', plantId: ramos!.id, calendarId: calRamos!.id, runCostPerHour: 95, setupCost: 70, overheadPerUnit: 0.45 }).returning()
    const [pressGrp] = await db.insert(resourceGroup).values({ tenantId, name: 'Saltillo stamping presses', plantId: saltillo!.id }).returning()
    const [weldGrp] = await db.insert(resourceGroup).values({ tenantId, name: 'Ramos weld cells', plantId: ramos!.id }).returning()
    await db.insert(resourceGroupMember).values([
      { tenantId, resourceGroupId: pressGrp!.id, resourceId: pressA!.id },
      { tenantId, resourceGroupId: pressGrp!.id, resourceId: pressB!.id },
      { tenantId, resourceGroupId: weldGrp!.id, resourceId: weld1!.id },
      { tenantId, resourceGroupId: weldGrp!.id, resourceId: weld2!.id },
    ])

    // parts (specific automotive components — informed guess; physical attrs drive changeover)
    const mkPart = async (v: { partNo: string; description: string; material: string; gauge: string; colour?: string }): Promise<string> =>
      (await db.insert(part).values({ tenantId, partType: 'finished', uom: 'EA', colour: null, ...v }).returning())[0]!.id
    const fg2001 = await mkPart({ partNo: 'FG-2001', description: 'Rear floor cross-member', material: 'Steel HSLA', gauge: '1.5mm', colour: 'Black' })
    const fg2002 = await mkPart({ partNo: 'FG-2002', description: 'B-pillar reinforcement, LH', material: 'Steel', gauge: '1.2mm', colour: 'Silver' })
    const fg2004 = await mkPart({ partNo: 'FG-2004', description: 'Front seat cross-member', material: 'Steel', gauge: '1.0mm', colour: 'Black' })
    const fg3001 = await mkPart({ partNo: 'FG-3001', description: 'Front rail weldment, LH', material: 'Steel', gauge: '2.0mm' })
    const fg3002 = await mkPart({ partNo: 'FG-3002', description: 'Rear shock-tower weldment', material: 'Steel', gauge: '1.8mm' })
    // Collision-3 ANCHOR (not a live mechanism): a purchased component whose shortage
    // forces priority allocation. NMA is deferred (SKIP-13) — this is a staged data
    // anchor + the Exception-Queue row (phases 4–5); REPLACE when NMA lands.
    await db.insert(part).values({ tenantId, partNo: 'PV-22', description: 'Reinforcement gusset (purchased — Collision-3 anchor; NMA SKIP-13)', partType: 'component', uom: 'EA', material: 'Steel', gauge: '2.0mm' })

    // routings (1 primary op each; std times = the `standard` baseline, D7).
    // Stamped FGs → presses (changeover on colour); welded FGs → weld cells (on material).
    const mkRouting = async (partId: string, name: string, groupId: string, setup: number, cycle: number, key: ChangeoverKey): Promise<void> => {
      const [rt] = await db.insert(routing).values({ tenantId, partId, name, isPrimary: true }).returning()
      await db.insert(routingOperation).values({ tenantId, routingId: rt!.id, opSeq: 10, resourceGroupId: groupId, stdSetupTime: setup, stdCycleTime: cycle, changeoverAttributeKey: key })
    }
    await mkRouting(fg2001, 'FG-2001 primary', pressGrp!.id, 30, 0.3, 'colour')
    await mkRouting(fg2002, 'FG-2002 primary', pressGrp!.id, 30, 0.3, 'colour')
    await mkRouting(fg2004, 'FG-2004 primary', pressGrp!.id, 28, 0.32, 'colour')
    await mkRouting(fg3001, 'FG-3001 primary', weldGrp!.id, 22, 1.4, 'material')
    await mkRouting(fg3002, 'FG-3002 primary', weldGrp!.id, 20, 1.45, 'material')

    // certifications (MD15)
    const mkCert = async (code: string, name: string, description: string): Promise<string> =>
      (await db.insert(certification).values({ tenantId, code, name, description }).returning())[0]!.id
    const leak = await mkCert('LEAK', 'Leak test', 'Leak-test station qualification')
    const torque = await mkCert('TORQUE', 'Torque-critical', 'Torque-critical fastening')
    const cmm = await mkCert('CMM', 'CMM inspection', 'Coordinate-measuring inspection')
    const weld = await mkCert('WELD', 'Weld certification', 'MIG / spot weld qualification')

    // operators + certs + next-shift presence (Workforce View 3 / Collision 4).
    // COHERENT cert gap: at Ramos Arizpe, LEAK has NO available certified operator —
    // Luis Cruz (the regular) is OUT → the gap; Jorge Morales (a DIFFERENT leak-cert
    // operator, off-shift, cheaper OT) is the call-in fill. The other certs are
    // covered by present staff → a single clean leak gap.
    const mkOp = async (name: string, plantId: string, available: boolean, laborRate: number): Promise<string> =>
      (await db.insert(operator).values({ tenantId, name, homePlantId: plantId, available, laborRate }).returning())[0]!.id
    const luis = await mkOp('Luis Cruz', ramos!.id, false, 28.0)
    const jorge = await mkOp('Jorge Morales', ramos!.id, false, 26.5)
    const diego = await mkOp('Diego Hernández', ramos!.id, true, 27.0)
    const maria = await mkOp('María Fuentes', ramos!.id, true, 27.5)
    const brunoG = await mkOp('Bruno García', ramos!.id, true, 24.5)
    const ana = await mkOp('Ana Reyes', saltillo!.id, true, 26.0)
    const sofia = await mkOp('Sofía Ramírez', saltillo!.id, true, 25.5)
    await db.insert(operatorQualification).values([
      { tenantId, operatorId: luis, certificationId: leak },
      { tenantId, operatorId: luis, certificationId: torque },
      { tenantId, operatorId: jorge, certificationId: leak },
      { tenantId, operatorId: diego, certificationId: weld },
      { tenantId, operatorId: diego, certificationId: torque },
      { tenantId, operatorId: maria, certificationId: weld },
      { tenantId, operatorId: maria, certificationId: cmm },
      { tenantId, operatorId: brunoG, certificationId: cmm },
      { tenantId, operatorId: ana, certificationId: torque },
      { tenantId, operatorId: sofia, certificationId: torque },
    ])

    // binding: masterdata.read → platform_module (the per-tenant counterpart)
    await db.insert(contractBinding).values({ tenantId, contractId: 'masterdata.read', major: '1', mode: 'platform_module' })

    // seeded demand (SKIP-10) — the four-collision spine; deterministic dates (Mon = 2026-06-15).
    // DL-1006 is due before it can finish → the sequencer COMPUTES it at-risk (never flagged).
    const D = (iso: string) => new Date(iso)
    type Firmness = 'firm' | 'forecast'
    const demand: {
      line: string; ref: string; part: string; plant: string; cust: string; prog: string | null; firm: Firmness; qty: number; due: string
    }[] = [
      // Saltillo (presses)
      { line: 'GP-1142', ref: 'GM-830-1142', part: fg2001, plant: saltillo!.id, cust: gm!.id, prog: gmProgram!.id, firm: 'firm', qty: 100, due: '2026-06-15T12:00:00Z' },
      { line: 'DL-1002', ref: 'GM-830-1002', part: fg2002, plant: saltillo!.id, cust: gm!.id, prog: gmProgram!.id, firm: 'firm', qty: 80, due: '2026-06-15T12:00:00Z' },
      { line: 'DL-1003', ref: 'NIS-862-1003', part: fg2004, plant: saltillo!.id, cust: nissan!.id, prog: null, firm: 'forecast', qty: 120, due: '2026-06-16T12:00:00Z' },
      { line: 'DL-1004', ref: 'GM-830-1004', part: fg2001, plant: saltillo!.id, cust: gm!.id, prog: gmProgram!.id, firm: 'firm', qty: 60, due: '2026-06-17T12:00:00Z' },
      { line: 'DL-1005', ref: 'AM-1005', part: fg2004, plant: saltillo!.id, cust: aftermarket!.id, prog: null, firm: 'forecast', qty: 40, due: '2026-06-16T12:00:00Z' },
      { line: 'DL-1006', ref: 'GM-830-1006', part: fg2002, plant: saltillo!.id, cust: gm!.id, prog: gmProgram!.id, firm: 'firm', qty: 70, due: '2026-06-15T00:45:00Z' }, // computed late
      // Ramos Arizpe (weld)
      { line: 'ST-8830', ref: 'STL-862-8830', part: fg3001, plant: ramos!.id, cust: stellantis!.id, prog: stelProgram!.id, firm: 'firm', qty: 90, due: '2026-06-16T12:00:00Z' },
      { line: 'DL-2002', ref: 'STL-862-2002', part: fg3002, plant: ramos!.id, cust: stellantis!.id, prog: stelProgram!.id, firm: 'firm', qty: 60, due: '2026-06-17T12:00:00Z' },
    ]
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
        requiredDate: D(r.due),
      })),
    )
    // Historical outcomes (phase 5, D57 measured_historical) — representative seed:
    // prior weeks' recorded actuals the baseline arm computes from. Saltillo (plant +
    // Press Line A) and Ramos have history; **Monterrey and Press Line B deliberately
    // have none** → the honest "no historical baseline yet" empty state is testable.
    // A real MES/historian writes the same rows later (source 'mes') with zero change.
    const ho = (
      plantId: string,
      resourceId: string | null,
      start: string,
      end: string,
      otif: number,
      costPerUnit: number,
      a: number,
      p: number,
      q: number,
      lateOrders: number,
      throughput: number,
    ) => ({
      tenantId,
      plantId,
      resourceId,
      periodStart: D(start),
      periodEnd: D(end),
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
    await db.insert(historicalOutcome).values([
      // Saltillo plant-level — three prior weeks (pre-platform performance).
      ho(saltillo!.id, null, '2026-05-25T00:00:00Z', '2026-05-29T23:59:59Z', 0.84, 8.9, 0.88, 0.79, 0.965, 3, 980),
      ho(saltillo!.id, null, '2026-06-01T00:00:00Z', '2026-06-05T23:59:59Z', 0.86, 8.7, 0.89, 0.8, 0.97, 2, 1010),
      ho(saltillo!.id, null, '2026-06-08T00:00:00Z', '2026-06-12T23:59:59Z', 0.85, 8.8, 0.88, 0.81, 0.968, 3, 995),
      // Press Line A line-level — the wear story's line, slightly worse historically.
      ho(saltillo!.id, pressA!.id, '2026-05-25T00:00:00Z', '2026-05-29T23:59:59Z', 0.8, 9.4, 0.85, 0.77, 0.96, 2, 520),
      ho(saltillo!.id, pressA!.id, '2026-06-01T00:00:00Z', '2026-06-05T23:59:59Z', 0.82, 9.2, 0.86, 0.78, 0.962, 1, 540),
      ho(saltillo!.id, pressA!.id, '2026-06-08T00:00:00Z', '2026-06-12T23:59:59Z', 0.81, 9.3, 0.85, 0.78, 0.96, 2, 530),
      // Ramos Arizpe plant-level.
      ho(ramos!.id, null, '2026-05-25T00:00:00Z', '2026-05-29T23:59:59Z', 0.88, 6.4, 0.9, 0.82, 0.975, 1, 760),
      ho(ramos!.id, null, '2026-06-01T00:00:00Z', '2026-06-05T23:59:59Z', 0.9, 6.2, 0.91, 0.83, 0.978, 1, 780),
      ho(ramos!.id, null, '2026-06-08T00:00:00Z', '2026-06-12T23:59:59Z', 0.89, 6.3, 0.9, 0.83, 0.976, 1, 770),
    ])

    console.log('  ✓ Magna de México scenario: 3 plants, 4 customers, 4 resources, 6 parts, 4 certs, 7 operators, 8 demand lines')
    console.log('  ✓ historical outcomes: 9 rows (Saltillo + Press Line A + Ramos); Monterrey/Press Line B = none (empty-state)')
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
