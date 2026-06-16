import type { ComponentProps, ReactNode } from 'react'
import { XStack, YStack } from 'tamagui'
import { P } from './typography'

/** Props for {@link Panel}. Extra props (flexGrow, flexBasis, minWidth, …) pass to the frame. */
export interface PanelProps extends ComponentProps<typeof YStack> {
  /** Panel title — rendered as a board/dashboard label (11 · 600 · caps · faint, UI §4). */
  title: string
  /** Optional right-aligned header slot (e.g. a chip or action). */
  headerRight?: ReactNode
  /** Content padding (default `$4`). Pass `$0` for a full-bleed body (e.g. a table). */
  contentPadding?: ComponentProps<typeof YStack>['padding']
  /** Vertical gap between content children (default `$3`). */
  contentGap?: ComponentProps<typeof YStack>['gap']
  children: ReactNode
}

/**
 * Panel — the one titled dashboard card (header + content), so every board /
 * dashboard surface (Scorecard tiles, Workforce coverage & readiness, …) shares
 * one chrome instead of re-styling a card inline (UI §0.1). The title follows the
 * board type map (label: 11 · 600 · caps · faint); the body is a slot. Layout
 * (flexGrow/basis/minWidth for a 60/40 split, etc.) is set by the caller via props.
 *
 * @example
 * <Panel title={t('readiness.title')} flexGrow={2} flexBasis={240} minWidth={240}>…</Panel>
 * <Panel title="Coverage" contentPadding="$0" contentGap="$0"><Table/><Legend/></Panel>
 */
export function Panel({
  title,
  headerRight,
  contentPadding = '$4',
  contentGap = '$3',
  children,
  ...frame
}: PanelProps) {
  return (
    <YStack
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$5"
      overflow="hidden"
      {...frame}
    >
      <XStack
        padding="$3"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        alignItems="center"
        justifyContent="space-between"
        gap="$2"
      >
        <P size={5} weight="b" caps color="$textTertiary">
          {title}
        </P>
        {headerRight}
      </XStack>
      <YStack padding={contentPadding} gap={contentGap}>
        {children}
      </YStack>
    </YStack>
  )
}
