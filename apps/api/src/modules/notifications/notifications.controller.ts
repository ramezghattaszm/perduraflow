import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { NotificationsService } from './notifications.service'

/** Authenticated `/notifications` routes — all scoped to the caller (JWT). */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** `GET /notifications` — the caller's notification feed. */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.notifications.list(user.sub)
  }

  /** `GET /notifications/unread-count` — the caller's unread count. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.notifications.unreadCount(user.sub)
  }

  /** `POST /notifications/:id/read` — mark one of the caller's notifications read. */
  @Post(':id/read')
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id)
  }

  /** `POST /notifications/read-all` — mark all of the caller's notifications read. */
  @Post('read-all')
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notifications.markAllRead(user.sub)
  }
}
