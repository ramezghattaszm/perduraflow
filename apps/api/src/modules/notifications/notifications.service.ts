import { HttpStatus, Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { assertOwnership } from '../../common/utils/ownership'
import { EVENTS, type ExampleEventPayload } from '../../events'
import { NotificationsRepository } from './notifications.repository'
import { toNotificationDto, type NotificationDto } from './notifications.types'

/**
 * In-app notification feed. All reads/writes are scoped to the caller's own
 * userId (from the JWT); notifications are created reactively from domain events.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  /** Lists the caller's own notifications (newest first). `userId` from the JWT. */
  async list(userId: string): Promise<NotificationDto[]> {
    return (await this.repo.listByUser(userId)).map(toNotificationDto)
  }

  /** The caller's unread notification count (`userId` from the JWT). */
  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.repo.countUnread(userId) }
  }

  /**
   * Marks one notification read. Ownership: `assertOwnership` ensures the
   * notification belongs to the caller (403-not-404, §11).
   *
   * @throws AppException NOT_FOUND - no notification with this id
   * @throws AppException FORBIDDEN - notification belongs to another user
   */
  async markRead(userId: string, id: string): Promise<{ success: true }> {
    const n = await this.repo.findById(id)
    if (!n) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Notification not found', ERROR_CODES.NOT_FOUND)
    }
    assertOwnership(userId, n.userId)
    await this.repo.markRead(id)
    return { success: true }
  }

  /** Marks all of the caller's notifications read (`userId` from the JWT). */
  async markAllRead(userId: string): Promise<{ success: true }> {
    await this.repo.markAllRead(userId)
    return { success: true }
  }

  /**
   * Event listener: creates an in-app notification for the owner when an example
   * is created (decoupled from the example module via EventEmitter2).
   */
  @OnEvent(EVENTS.EXAMPLE_CREATED)
  async onExampleCreated(payload: ExampleEventPayload): Promise<void> {
    await this.repo.create({
      userId: payload.ownerId,
      type: 'example.created',
      title: 'Example created',
      body: `Your example was created.`,
    })
  }
}
