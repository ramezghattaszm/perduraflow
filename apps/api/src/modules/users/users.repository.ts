import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE, type Database } from '../../db/drizzle.module'
import { user, type User } from '../../db/schema'

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findById(id: string): Promise<User | undefined> {
    return this.db.query.user.findFirst({ where: eq(user.id, id) })
  }

  async update(
    id: string,
    data: Partial<Pick<User, 'name' | 'avatarUrl'>>,
  ): Promise<User | undefined> {
    const [updated] = await this.db
      .update(user)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(user.id, id))
      .returning()
    return updated
  }
}
