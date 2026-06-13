import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, lt } from 'drizzle-orm'
import { DRIZZLE, type Database } from '../../db/drizzle.module'
import { example, type Example } from '../../db/schema'

/**
 * Repository for the example resource. Every query is scoped by tenantId, and
 * soft-deleted rows (isActive=false) are excluded. ULID ids are monotonic, so
 * `id < cursor DESC` gives stable cursor pagination.
 */
@Injectable()
export class ExampleRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(data: {
    ownerId: string
    tenantId: string
    title: string
    description: string | null
  }): Promise<Example> {
    const [created] = await this.db.insert(example).values(data).returning()
    return created!
  }

  findById(id: string): Promise<Example | undefined> {
    return this.db.query.example.findFirst({ where: eq(example.id, id) })
  }

  listByOwner(
    ownerId: string,
    tenantId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Example[]> {
    const conds = [
      eq(example.ownerId, ownerId),
      eq(example.tenantId, tenantId),
      eq(example.isActive, true),
    ]
    if (cursor) conds.push(lt(example.id, cursor))
    return this.db
      .select()
      .from(example)
      .where(and(...conds))
      .orderBy(desc(example.id))
      .limit(limit)
  }

  listByTenant(tenantId: string, cursor: string | undefined, limit: number): Promise<Example[]> {
    const conds = [eq(example.tenantId, tenantId), eq(example.isActive, true)]
    if (cursor) conds.push(lt(example.id, cursor))
    return this.db
      .select()
      .from(example)
      .where(and(...conds))
      .orderBy(desc(example.id))
      .limit(limit)
  }

  async update(
    id: string,
    patch: Partial<Pick<Example, 'title' | 'description'>>,
  ): Promise<Example> {
    const [updated] = await this.db
      .update(example)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(example.id, id))
      .returning()
    return updated!
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(example)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(example.id, id))
  }
}
