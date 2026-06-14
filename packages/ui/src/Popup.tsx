import type { ReactNode } from 'react'
import { Portal, Sheet, useMedia, XStack, YStack } from 'tamagui'
import { H, P } from './typography'

/**
 * Popup — one responsive modal primitive driven by an explicit `useMedia`
 * branch (no `Adapt`):
 *  - **small screens** (≤ md) → a real Tamagui `Sheet` (`native` so iOS/Android
 *    get the platform bottom sheet, with drag-to-dismiss / snap);
 *  - **larger screens** → a centered dialog (Portal + `position:fixed` scrim).
 *
 * High z-index so it always sits above other overlays. Presentational only — the
 * app drives one at a time via the popup store + `PopupHost` (see `usePopup`).
 *
 * @example
 * <Popup open={open} onClose={close} title="Heads up" footer={<AppButton onPress={close}>OK</AppButton>}>
 *   <P size={4}>Body content.</P>
 * </Popup>
 */
export type PopupSize = 'small' | 'medium' | 'large'

const MAX_WIDTH: Record<PopupSize, number> = { small: 420, medium: 600, large: 820 }
const Z = 200000

export interface PopupProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Secondary line under the title (the "message"). */
  description?: string
  size?: PopupSize
  /** When false, overlay-press / drag-to-dismiss are disabled. Default true. */
  dismissable?: boolean
  /** Action row (right-aligned on desktop; below the content in the sheet). */
  footer?: ReactNode
  children?: ReactNode
}

/**
 * Responsive modal: a native-capable bottom sheet on small screens, a centered
 * dialog on larger ones.
 *
 * @example
 * <Popup open={open} onClose={close} title="Delete?" footer={<AppButton onPress={remove}>Delete</AppButton>} />
 */
export function Popup({
  open,
  onClose,
  title,
  description,
  size = 'small',
  dismissable = true,
  footer,
  children,
}: PopupProps) {
  const media = useMedia()
  // v5 media is mobile-first/min-width (media.sm = width >= 640), so use the
  // max-width key for "small screen": <= 767.98px gets the bottom sheet.
  const isSheet = Boolean(media['max-md'])

  const body = (
    <>
      {title ? (
        <H level={4} color="$textPrimary">
          {title}
        </H>
      ) : null}
      {description ? (
        <P size={4} color="$textSecondary">
          {description}
        </P>
      ) : null}
      {children}
      {footer ? (
        <XStack justifyContent="flex-end" gap="$3" marginTop="$2" flexWrap="wrap">
          {footer}
        </XStack>
      ) : null}
    </>
  )

  if (isSheet) {
    return (
      <Sheet
        modal
        native
        open={open}
        onOpenChange={(next: boolean) => {
          if (!next) onClose()
        }}
        snapPoints={[60]}
        dismissOnSnapToBottom={dismissable}
        dismissOnOverlayPress={dismissable}
        zIndex={Z}
        // The Sheet controller drives the frame's slide via the animation driver
        // — required, or the frame sits off-screen. The `animation` prop is valid
        // at runtime; its type isn't resolving through the workspace config build.
        // @ts-expect-error tamagui animation prop typing gap (see comment)
        animation="quick"
      >
        <Sheet.Overlay backgroundColor="$overlay" />
        <Sheet.Frame
          padding="$5"
          gap="$3"
          backgroundColor="$surface"
          borderTopLeftRadius="$6"
          borderTopRightRadius="$6"
        >
          <Sheet.Handle
            alignSelf="center"
            width={44}
            height={4}
            borderRadius="$10"
            backgroundColor="$borderColor"
          />
          <Sheet.ScrollView>
            <YStack gap="$3" paddingBottom="$4">
              {body}
            </YStack>
          </Sheet.ScrollView>
        </Sheet.Frame>
      </Sheet>
    )
  }

  // Larger screens → centered dialog (Portal + fixed scrim).
  if (!open) return null
  return (
    <Portal>
      <YStack
        position="fixed"
        top={0}
        left={0}
        right={0}
        bottom={0}
        zIndex={Z}
        backgroundColor="$overlay"
        alignItems="center"
        justifyContent="center"
        padding="$4"
        onPress={dismissable ? onClose : undefined}
      >
        <YStack
          onPress={(e) => e.stopPropagation()}
          backgroundColor="$surface"
          borderColor="$borderColor"
          borderWidth={1}
          borderRadius="$6"
          width="90%"
          maxWidth={MAX_WIDTH[size]}
          maxHeight="90%"
          padding="$5"
          gap="$3"
          overflow="hidden"
        >
          {body}
        </YStack>
      </YStack>
    </Portal>
  )
}
