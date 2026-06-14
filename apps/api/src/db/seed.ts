import * as bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import { tenant } from '../modules/tenant/schema'
import { approvalTier, role, user } from '../modules/auth/schema'
import { calendar, customer, plant, plantGroup, plantGroupMember, program } from '../modules/org/schema'

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
  const existingTenant = (await db.select().from(tenant).limit(1))[0]
  const tenantRow = existingTenant ?? (await db.insert(tenant).values({ name: 'Default' }).returning())[0]
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

  console.log(`\nSeed complete. Log in as ${ADMIN_EMAIL} / "${DEFAULT_PASSWORD}".`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
