import { Inject, Injectable } from '@nestjs/common'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { DRIZZLE, type Database } from '../../db/drizzle.module'
import { notification, type Notification } from '../../db/schema'

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(data: {
    userId: string
    type: string
    title: string
    body: string | null
  }): Promise<void> {
    await this.db.insert(notification).values(data)
  }

  listByUser(userId: string, limit = 50): Promise<Notification[]> {
    return this.db
      .select()
      .from(notification)
      .where(eq(notification.userId, userId))
      .orderBy(desc(notification.createdAt))
      .limit(limit)
  }

  findById(id: string): Promise<Notification | undefined> {
    return this.db.query.notification.findFirst({ where: eq(notification.id, id) })
  }

  async markRead(id: string): Promise<void> {
    await this.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(eq(notification.id, id))
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
  }

  async countUnread(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ c: count() })
      .from(notification)
      .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    return row?.c ?? 0
  }
}
