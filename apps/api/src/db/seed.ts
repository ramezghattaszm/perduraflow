import * as bcrypt from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
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
import { demandInput } from '../modules/scheduling/schema'

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

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  const db = drizzle(pool)

  // --- tenant ----------------------------------------------------------------
  // Demo client identity for the shell's brand zone. logoUrl stays null so the
  // OrgAvatar placeholder shows — real logos are tenant-supplied (SKIP-53).
  const DEMO_TENANT = { name: 'Saltillo Industrial Group', logoUrl: null as string | null }
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

  // --- sample org rows -------------------------------------------------------
  const existingPlants = await db.select().from(plant).where(eq(plant.tenantId, tenantId))
  if (existingPlants.length === 0) {
    const [p1] = await db
      .insert(plant)
      .values({ tenantId, name: 'Saltillo Stamping', timezone: 'America/Mexico_City', region: 'Coahuila' })
      .returning()
    const [p2] = await db
      .insert(plant)
      .values({ tenantId, name: 'Ramos Arizpe Molding', timezone: 'America/Mexico_City', region: 'Coahuila' })
      .returning()
    const [grp] = await db
      .insert(plantGroup)
      .values({ tenantId, name: 'Coahuila cluster', groupType: 'cluster', allowsResourceSharing: false })
      .returning()
    await db.insert(plantGroupMember).values([
      { tenantId, plantGroupId: grp!.id, plantId: p1!.id },
      { tenantId, plantGroupId: grp!.id, plantId: p2!.id },
    ])
    const [cust] = await db
      .insert(customer)
      .values({ tenantId, name: 'General Motors', firmFenceDays: 14 })
      .returning()
    await db.insert(program).values({ tenantId, customerId: cust!.id, name: 'GMT900', firmFenceDays: 21 })
    await db.insert(calendar).values({
      tenantId,
      plantId: p1!.id,
      name: 'Saltillo 3-shift',
      shiftPatterns: [{ name: 'A', start: '06:00', end: '14:00' }],
      holidays: [],
      maintenanceWindows: [],
    })
    console.log('  ✓ sample org: 2 plants, 1 cluster, 1 customer, 1 program, 1 calendar')
  }

  // --- customer/program priority (phase 1, MD15 — set on the seeded rows) -----
  await db.update(customer).set({ priority: 'critical' }).where(eq(customer.name, 'General Motors'))
  await db.update(program).set({ priority: 'high' }).where(eq(program.name, 'GMT900'))

  // --- sample master data (phase 1) — references existing plants + calendar ---
  const existingParts = await db.select().from(part).where(eq(part.tenantId, tenantId))
  if (existingParts.length === 0) {
    const plants = await db.select().from(plant).where(eq(plant.tenantId, tenantId))
    const cals = await db.select().from(calendar).where(eq(calendar.tenantId, tenantId))
    const p1 = plants[0]
    const cal = cals[0]
    if (p1 && cal) {
      // parts (current-version only; physical attrs are the changeover drivers)
      const [fg] = await db
        .insert(part)
        .values({ tenantId, partNo: 'FG-1001', description: 'Floor pan assembly', partType: 'finished', uom: 'EA', material: 'Steel', gauge: '1.2mm', colour: 'Black' })
        .returning()
      await db
        .insert(part)
        .values({ tenantId, partNo: 'CMP-2001', description: 'Reinforcement bracket', partType: 'component', uom: 'EA', material: 'Steel', gauge: '2.0mm' })

      // resources (referencing the seeded plant + calendar via text id, no FK)
      const [press] = await db
        .insert(resource)
        .values({ tenantId, name: 'Press Line A', resourceType: 'line', plantId: p1.id, calendarId: cal.id, rate: 12, rateUom: 'strokes/min' })
        .returning()
      const [weld] = await db
        .insert(resource)
        .values({ tenantId, name: 'Weld Cell 2', resourceType: 'cell', plantId: p1.id, calendarId: cal.id })
        .returning()

      // resource group + members
      const [grp] = await db
        .insert(resourceGroup)
        .values({ tenantId, name: 'Stamping presses', plantId: p1.id })
        .returning()
      await db.insert(resourceGroupMember).values([
        { tenantId, resourceGroupId: grp!.id, resourceId: press!.id },
        { tenantId, resourceGroupId: grp!.id, resourceId: weld!.id },
      ])

      // routing + ordered operations (std times = the `standard` baseline, D7)
      const [rt] = await db
        .insert(routing)
        .values({ tenantId, partId: fg!.id, name: 'FG-1001 primary', isPrimary: true })
        .returning()
      await db.insert(routingOperation).values([
        { tenantId, routingId: rt!.id, opSeq: 10, resourceGroupId: grp!.id, stdSetupTime: 30, stdCycleTime: 1.2, changeoverAttributeKey: 'colour' },
        { tenantId, routingId: rt!.id, opSeq: 20, resourceGroupId: grp!.id, stdSetupTime: 15, stdCycleTime: 0.8, changeoverAttributeKey: null },
      ])

      // certification taxonomy (MD15)
      const [leak] = await db.insert(certification).values({ tenantId, code: 'LEAK', name: 'Leak test', description: 'Leak-test station qualification' }).returning()
      const [torque] = await db.insert(certification).values({ tenantId, code: 'TORQUE', name: 'Torque-critical', description: 'Torque-critical fastening' }).returning()
      const [cmm] = await db.insert(certification).values({ tenantId, code: 'CMM', name: 'CMM inspection' }).returning()

      // operators (externally-sourced stubs) + qualifications
      const [ana] = await db.insert(operator).values({ tenantId, name: 'Ana Reyes', homePlantId: p1.id, laborRate: 26 }).returning()
      const [bruno] = await db.insert(operator).values({ tenantId, name: 'Bruno Cruz', homePlantId: p1.id, laborRate: 24.5 }).returning()
      await db.insert(operatorQualification).values([
        { tenantId, operatorId: ana!.id, certificationId: leak!.id },
        { tenantId, operatorId: ana!.id, certificationId: torque!.id },
        { tenantId, operatorId: bruno!.id, certificationId: cmm!.id },
      ])
      console.log('  ✓ sample master data: 2 parts, 2 resources, 1 group, 1 routing (2 ops), 3 certs, 2 operators')
    }
  }

  // --- phase 2: binding (masterdata.read → platform_module) -------------------
  const existingBinding = await db.select().from(contractBinding).where(eq(contractBinding.tenantId, tenantId))
  if (existingBinding.length === 0) {
    await db.insert(contractBinding).values({ tenantId, contractId: 'masterdata.read', major: '1', mode: 'platform_module' })
    console.log('  ✓ binding: masterdata.read/1 → platform_module')
  }

  // --- phase 2: extra coloured parts + routings + seeded demand ---------------
  const fg1002 = await db.select().from(part).where(and(eq(part.tenantId, tenantId), eq(part.partNo, 'FG-1002')))
  if (fg1002.length === 0) {
    const plants = await db.select().from(plant).where(eq(plant.tenantId, tenantId))
    const groups = await db.select().from(resourceGroup).where(eq(resourceGroup.tenantId, tenantId))
    const custs = await db.select().from(customer).where(eq(customer.tenantId, tenantId))
    const progs = await db.select().from(program).where(eq(program.tenantId, tenantId))
    const parts1001 = await db.select().from(part).where(and(eq(part.tenantId, tenantId), eq(part.partNo, 'FG-1001')))
    const p1 = plants[0]
    const grp = groups[0]
    const cust = custs[0]
    const prog = progs[0]
    const fg1001 = parts1001[0]
    if (p1 && grp && cust && fg1001) {
      // two more finished parts with different colours (changeover variety)
      const [fgSilver] = await db
        .insert(part)
        .values({ tenantId, partNo: 'FG-1002', description: 'Door inner — silver', partType: 'finished', uom: 'EA', material: 'Steel', gauge: '1.0mm', colour: 'Silver' })
        .returning()
      const [fgBlack2] = await db
        .insert(part)
        .values({ tenantId, partNo: 'FG-1003', description: 'Cross member — black', partType: 'finished', uom: 'EA', material: 'Steel', gauge: '1.5mm', colour: 'Black' })
        .returning()
      // a 1-op primary routing on the stamping group for each (changeover keyed on colour)
      for (const fgp of [fgSilver!, fgBlack2!]) {
        const [rt] = await db
          .insert(routing)
          .values({ tenantId, partId: fgp.id, name: `${fgp.partNo} primary`, isPrimary: true })
          .returning()
        await db.insert(routingOperation).values({ tenantId, routingId: rt!.id, opSeq: 10, resourceGroupId: grp.id, stdSetupTime: 20, stdCycleTime: 1.0, changeoverAttributeKey: 'colour' })
      }
      // seeded demand (SKIP-10): mixed colours, firmness, due-date spread (deterministic dates)
      const D = (iso: string) => new Date(iso)
      const rows = [
        { line: 'DL-0001', part: fg1001.id, firm: 'firm', qty: 100, due: '2026-06-15T12:00:00Z' }, // Black, Mon
        { line: 'DL-0002', part: fgSilver!.id, firm: 'firm', qty: 80, due: '2026-06-15T12:00:00Z' }, // Silver, Mon
        { line: 'DL-0003', part: fgBlack2!.id, firm: 'forecast', qty: 60, due: '2026-06-16T12:00:00Z' }, // Black, Tue
        { line: 'DL-0004', part: fg1001.id, firm: 'forecast', qty: 50, due: '2026-06-16T12:00:00Z' }, // Black, Tue
        { line: 'DL-0005', part: fgSilver!.id, firm: 'firm', qty: 120, due: '2026-06-17T12:00:00Z' }, // Silver, Wed
        { line: 'DL-0006', part: fgBlack2!.id, firm: 'firm', qty: 60, due: '2026-06-15T00:45:00Z' }, // Black — due too early ⇒ at-risk (late)
        { line: 'DL-0007', part: fg1001.id, firm: 'forecast', qty: 30, due: '2026-06-15T12:00:00Z' }, // Black, Mon
        { line: 'DL-0008', part: fgSilver!.id, firm: 'firm', qty: 70, due: '2026-06-16T12:00:00Z' }, // Silver, Tue
      ] as const
      await db.insert(demandInput).values(
        rows.map((r) => ({
          tenantId,
          demandLineId: r.line,
          releaseReference: 'REL-830-001',
          partId: r.part,
          plantId: p1.id,
          customerId: cust.id,
          programId: prog?.id ?? null,
          demandType: 'stock' as const,
          firmness: r.firm,
          requiredQty: r.qty,
          uom: 'EA',
          requiredDate: D(r.due),
        })),
      )
      console.log('  ✓ phase-2 seed: 2 coloured parts + routings, 8 demand lines')
    }
  }

  console.log(`\nSeed complete. Log in as ${ADMIN_EMAIL} / "${DEFAULT_PASSWORD}".`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
