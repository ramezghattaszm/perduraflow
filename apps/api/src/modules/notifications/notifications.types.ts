import type { Notification } from '../../db/schema'

/** In-app notification DTO. (Module-local until a client needs it in contracts.) */
export interface NotificationDto {
  id: string
  type: string
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
}

/** Maps a notification DB row to its API DTO (dates serialized to ISO strings). */
export function toNotificationDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }
}
