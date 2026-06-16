import { type ReactNode, useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Portal, ScrollView, Sheet, useMedia, XStack, YStack } from 'tamagui'
import { H, P } from './typography'

/**
 * Current on-screen keyboard height (0 when hidden). iOS reports `will*` events
 * (smooth, ahead of the animation); Android only fires `did*`. Returns 0 on web
 * (the RN-web Keyboard never emits), so callers can add it as padding safely.
 */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates?.height ?? 0))
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}

/**
 * Popup — the one responsive modal primitive, driven by an explicit `useMedia`
 * branch (no `Adapt`):
 *  - **small screens** (≤ md) → a real Tamagui `Sheet` (`native` so iOS/Android
 *    get the platform bottom sheet, with drag-to-dismiss / snap);
 *  - **larger screens** → a centered dialog (Portal + `position:fixed` scrim).
 *
 * Layout is fixed header (title/description) · scrollable body (`children`) ·
 * error line · fixed footer — so tall forms scroll while the actions stay put.
 * Used two ways: declaratively for create/edit forms (the screen owns the form
 * state, `dismissable={false}`), and via the `usePopup` store for one-off
 * confirms/alerts. High z-index so it always sits above other overlays.
 *
 * @example
 * <Popup open={open} onClose={close} title="Heads up" footer={<AppButton onPress={close}>OK</AppButton>}>
 *   <P size={3}>Body content.</P>
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
  /** When false, overlay-press / drag-to-dismiss are disabled (e.g. forms). Default true. */
  dismissable?: boolean
  /** Inline error shown above the footer (e.g. a rejected server/contract write). */
  error?: string
  /** Action row (right-aligned on desktop; below the content in the sheet). */
  footer?: ReactNode
  /** Sheet snap point(s), percent of screen height. Defaults to a single `[80]`;
   *  override for taller/shorter forms (small screens only). */
  snapPoints?: number[]
  /** How the sheet reacts to the keyboard (small screens): `pad` lifts the actions
   *  above the keyboard via bottom padding (default, safest); `move` translates the
   *  whole sheet up partially. */
  keyboardMotion?: 'pad' | 'move'
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
  error,
  footer,
  snapPoints = [80],
  keyboardMotion = 'pad',
  children,
}: PopupProps) {
  const media = useMedia()
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardHeight()
  // v5 media is mobile-first/min-width (media.sm = width >= 640), so use the
  // max-width key for "small screen": <= 767.98px gets the bottom sheet.
  const isSheet = Boolean(media['max-md'])

  const header =
    title || description ? (
      <YStack gap="$1">
        {title ? (
          <H level={4} color="$textPrimary">
            {title}
          </H>
        ) : null}
        {description ? (
          <P size={3} color="$textSecondary">
            {description}
          </P>
        ) : null}
      </YStack>
    ) : null

  const errorLine = error ? (
    <P size={4} color="$danger">
      {error}
    </P>
  ) : null

  const footerRow = footer ? (
    <XStack justifyContent="flex-end" gap="$3" marginTop="$2" flexWrap="wrap">
      {footer}
    </XStack>
  ) : null

  if (isSheet) {
    return (
      <Sheet
        modal
        // No `native`: that renders the iOS UIKit sheet, which ignores our
        // snapPoints / Sheet.ScrollView drag handoff and dismisses erratically on a
        // small drag. The JS sheet (via GestureHandlerRootView at the app root) is
        // consistent across iOS + Android.
        open={open}
        onOpenChange={(next: boolean) => {
          if (!next) onClose()
        }}
        snapPoints={snapPoints}
        // Single snap point: a downward drag either snaps back (forms) or dismisses
        // (when dismissable) — it never rests at an intermediate lower point.
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
          paddingTop="$5"
          gap="$3"
          backgroundColor="$surface"
          borderTopLeftRadius="$6"
          borderTopRightRadius="$6"
          // Keyboard handling. The bottom safe-area inset is ALWAYS included so the
          // footer never lands in the home-indicator / gesture-nav area. On iOS the
          // window doesn't resize, so `pad` adds the keyboard height (lifting the
          // footer above it) and `move` translates the frame up partially. On Android
          // the OS resizes the window for the keyboard, so only the inset is needed.
          style={{
            paddingBottom:
              insets.bottom + 16 + (Platform.OS === 'ios' && keyboardMotion === 'pad' ? keyboardHeight : 0),
            transform:
              Platform.OS === 'ios' && keyboardMotion === 'move'
                ? [{ translateY: -keyboardHeight * 0.6 }]
                : [],
          }}
        >
          <Sheet.Handle
            alignSelf="center"
            width={44}
            height={4}
            borderRadius="$10"
            backgroundColor="$borderColor"
          />
          {/* Horizontal padding lives on each section, not the frame, so the
              ScrollView spans the full width and its scrollbar sits flush to the
              sheet's right edge (matching the desktop dialog). */}
          {header ? <YStack paddingHorizontal="$5">{header}</YStack> : null}
          <Sheet.ScrollView keyboardShouldPersistTaps="handled">
            <YStack gap="$3" paddingHorizontal="$5" paddingBottom="$4">
              {children}
            </YStack>
          </Sheet.ScrollView>
          {errorLine ? <YStack paddingHorizontal="$5">{errorLine}</YStack> : null}
          {footerRow ? <YStack paddingHorizontal="$5">{footerRow}</YStack> : null}
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
        // The Tamagui Portal host is pointer-events:none, and pointer-events
        // inherits — without this the scrim paints the dim but lets clicks/hover
        // fall through to the content behind it. Re-enable hit-testing here.
        pointerEvents="auto"
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
          paddingVertical="$5"
          gap="$3"
          overflow="hidden"
        >
          {/* Horizontal padding lives on the sections, not the card, so the body
              ScrollView spans the full width and its scrollbar sits flush to the
              card's right edge (no padding gutter beside it). */}
          {header ? <YStack paddingHorizontal="$5">{header}</YStack> : null}
          {/* flexShrink + minHeight:0 (not flex:1) so the body sizes to content and
              scrolls only when the card hits maxHeight — flex:1 sets basis 0% and
              collapses the body to nothing inside an auto-height card. */}
          <ScrollView flexShrink={1} minHeight={0}>
            <YStack gap="$3" paddingHorizontal="$5">
              {children}
            </YStack>
          </ScrollView>
          {errorLine ? <YStack paddingHorizontal="$5">{errorLine}</YStack> : null}
          {footerRow ? <YStack paddingHorizontal="$5">{footerRow}</YStack> : null}
        </YStack>
      </YStack>
    </Portal>
  )
}
