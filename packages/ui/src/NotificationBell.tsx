import { Bell } from '@tamagui/lucide-icons'
import { Portal, ScrollView, YStack } from 'tamagui'
import { EmptyState } from './EmptyState'
import { IconButton } from './IconButton'
import { H, P } from './typography'

/** A single notification entry shown in the bell popover. */
export interface NotificationItem {
  id: string
  title: string
  body?: string
}

/** Props for {@link NotificationBell}. */
export interface NotificationBellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items?: NotificationItem[]
  /** Heading + empty-state copy (i18n-resolved by the caller). */
  title?: string
  emptyText?: string
}

/**
 * NotificationBell — bell + unread dot that opens a popover on `$surfaceRaised`
 * (UI shell spec §5). Controlled (so the TopBar can keep only one of
 * notifications / account menu open at a time). Presentational this phase: it just
 * lists seeded `items` or an "all caught up" empty state; the rules→channels
 * engine is SKIP-23.
 *
 * @example
 * <NotificationBell open={open === 'bell'} onOpenChange={(o) => setOpen(o ? 'bell' : 'none')} items={items} />
 */
export function NotificationBell({
  open,
  onOpenChange,
  items = [],
  title = 'Notifications',
  emptyText = 'You’re all caught up',
}: NotificationBellProps) {
  const unread = items.length > 0
  return (
    <YStack>
      <YStack position="relative">
        <IconButton icon={Bell} label={title} active={open} onPress={() => onOpenChange(!open)} />
        {unread ? (
          <YStack
            position="absolute"
            top={8}
            right={8}
            width={8}
            height={8}
            borderRadius={4}
            backgroundColor="$danger"
            pointerEvents="none"
          />
        ) : null}
      </YStack>
      {open ? (
        <Portal>
          <YStack
            position="fixed"
            top={0}
            left={0}
            right={0}
            bottom={0}
            zIndex={250000}
            pointerEvents="auto"
            onPress={() => onOpenChange(false)}
          />
          <YStack
            position="fixed"
            top={56}
            right={8}
            width={320}
            maxHeight={420}
            zIndex={250001}
            pointerEvents="auto"
            backgroundColor="$surfaceRaised"
            borderColor="$borderColor"
            borderWidth={1}
            borderRadius="$5"
            elevation="$4"
            overflow="hidden"
          >
            <YStack paddingHorizontal="$4" paddingVertical="$3" borderBottomWidth={1} borderBottomColor="$borderColor">
              <H level={5}>{title}</H>
            </YStack>
            {items.length === 0 ? (
              <YStack padding="$4">
                <EmptyState title={emptyText} />
              </YStack>
            ) : (
              <ScrollView>
                <YStack>
                  {items.map((it) => (
                    <YStack
                      key={it.id}
                      paddingHorizontal="$4"
                      paddingVertical="$3"
                      gap="$1"
                      borderBottomWidth={1}
                      borderBottomColor="$borderColor"
                      hoverStyle={{ backgroundColor: '$hoverFill' }}
                    >
                      <P size={4} weight="b">
                        {it.title}
                      </P>
                      {it.body ? (
                        <P size={5} color="$textSecondary">
                          {it.body}
                        </P>
                      ) : null}
                    </YStack>
                  ))}
                </YStack>
              </ScrollView>
            )}
          </YStack>
        </Portal>
      ) : null}
    </YStack>
  )
}
