import { type ComponentProps, type ReactNode, useState } from 'react'
import { YStack } from 'tamagui'
import { P } from './typography'

// Tamagui forwards hover events at runtime, but the workspace's stripped View
// types omit them; this localized cast adds them without an `@ts-expect-error`.
type HoverProps = ComponentProps<typeof YStack> & { onHoverIn?: () => void; onHoverOut?: () => void }
const HoverStack = YStack as unknown as (props: HoverProps) => ReactNode

/** Props for {@link AppTooltip}. */
export interface AppTooltipProps {
  label: string
  /** Where the label appears relative to the trigger. Default `right` (rail use). */
  placement?: 'right' | 'top'
  /** Suppress the tooltip (e.g. when the sidebar is expanded). */
  disabled?: boolean
  children: ReactNode
}

/**
 * AppTooltip — a lightweight hover label, used mainly for the collapsed sidebar
 * rail (UI shell spec §6). Pure hover state + an absolutely positioned label on
 * `$surfaceRaised`; no portal/animation so it stays SSR- and type-safe. Hover is
 * web-only — on native it renders just `children`. Named `AppTooltip` to avoid
 * colliding with Tamagui's own `Tooltip`.
 *
 * @example
 * <AppTooltip label="Plants"><FactoryIcon /></AppTooltip>
 */
export function AppTooltip({ label, placement = 'right', disabled, children }: AppTooltipProps) {
  const [open, setOpen] = useState(false)
  const pos =
    placement === 'right'
      ? { left: '100%' as const, top: 0, marginLeft: '$2' as const }
      : { bottom: '100%' as const, left: 0, marginBottom: '$2' as const }
  return (
    <HoverStack position="relative" onHoverIn={() => setOpen(true)} onHoverOut={() => setOpen(false)}>
      {children}
      {open && !disabled ? (
        <YStack
          position="absolute"
          {...pos}
          zIndex={300000}
          pointerEvents="none"
          backgroundColor="$surfaceRaised"
          borderColor="$borderColor"
          borderWidth={1}
          borderRadius="$3"
          paddingHorizontal="$2"
          paddingVertical="$1.5"
          elevation="$2"
        >
          <P size={4} color="$textPrimary" style={{ whiteSpace: 'nowrap' }}>
            {label}
          </P>
        </YStack>
      ) : null}
    </HoverStack>
  )
}
