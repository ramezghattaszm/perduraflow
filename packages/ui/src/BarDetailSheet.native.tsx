import { Sheet, YStack } from 'tamagui'
import type { BarDetailSheetProps } from './BarDetailSheet'

export type { BarDetailSheetProps } from './BarDetailSheet'

/**
 * BarDetailSheet — NATIVE: a bottom sheet sliding up from the bottom (full width)
 * with the same self-contained content (identity + learned + performance). A bar-
 * anchored popover would be cramped and cover the tapped bar; the sheet is the
 * native-standard pattern. Tap bar → sheet up; dismiss (drag / overlay) → board.
 * The JS sheet (not `native`) is consistent across iOS + Android (see Popup).
 */
export function BarDetailSheet({ open, onClose, children }: BarDetailSheetProps) {
  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose()
      }}
      snapPoints={[60]}
      dismissOnSnapToBottom
      dismissOnOverlayPress
      zIndex={250000}
      // @ts-expect-error tamagui animation prop typing gap (mirrors Popup)
      animation="quick"
    >
      <Sheet.Overlay backgroundColor="$overlay" />
      <Sheet.Frame
        backgroundColor="$surface"
        borderTopLeftRadius="$6"
        borderTopRightRadius="$6"
        paddingTop="$3"
        gap="$3"
      >
        <Sheet.Handle alignSelf="center" width={44} height={4} borderRadius="$10" backgroundColor="$borderColor" />
        <Sheet.ScrollView>
          <YStack paddingHorizontal="$4" paddingBottom="$6">
            {children}
          </YStack>
        </Sheet.ScrollView>
      </Sheet.Frame>
    </Sheet>
  )
}
