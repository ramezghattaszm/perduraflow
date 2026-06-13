import * as bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import * as schema from './schema'
import { example, tenant, user, type User } from './schema'

/**
 * Generic seed (safe defaults): one default tenant, an admin + two regular
 * users (all verified, password "Password123"), and a couple of example rows
 * owned by Alice. Idempotent. No app-specific data.
 */
const DEFAULT_PASSWORD = 'Password123'

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  // Default tenant
  const existingTenant = (await db.select().from(tenant).limit(1))[0]
  const tenantRow = existingTenant ?? (await db.insert(tenant).values({ name: 'Default' }).returning())[0]
  const tenantId = tenantRow!.id
  console.log(`  ✓ tenant: ${tenantId}`)

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
  const upsertUser = async (
    name: string,
    email: string,
    role: 'user' | 'admin',
  ): Promise<User> => {
    const existing = await db.query.user.findFirst({ where: eq(user.email, email) })
    if (existing) return existing
    const [created] = await db
      .insert(user)
      .values({ tenantId, name, email, passwordHash, isVerified: true, role })
      .returning()
    console.log(`  ✓ user: ${email} (${role})`)
    return created!
  }

  await upsertUser('Admin', 'admin@perduraflow.test', 'admin')
  const alice = await upsertUser('Alice', 'alice@perduraflow.test', 'user')
  await upsertUser('Bob', 'bob@perduraflow.test', 'user')

  const existingExamples = await db.select().from(example).where(eq(example.ownerId, alice.id))
  if (existingExamples.length === 0) {
    await db.insert(example).values([
      { ownerId: alice.id, tenantId, title: 'First example', description: 'A seeded example.' },
      { ownerId: alice.id, tenantId, title: 'Second example', description: null },
    ])
    console.log('  ✓ seeded 2 example rows (owner: Alice)')
  }

  console.log(`\nSeed complete. Login with any user above / password "${DEFAULT_PASSWORD}".`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
