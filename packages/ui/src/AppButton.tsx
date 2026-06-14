import { forwardRef, type ComponentType, type ReactNode } from 'react'
import {
  Button,
  Spinner,
  Text,
  XStack,
  styled,
  type ColorTokens,
  type FontSizeTokens,
  type GetProps,
  type TamaguiElement,
} from 'tamagui'

/**
 * AppButton (UI-ARCHITECTURE.md §5).
 *
 * Two hard rules from the architecture:
 *  - Never pass `disabled` to a Tamagui Button (Reanimated hook instability on
 *    native). Simulate it with opacity + pointerEvents + an onPress guard.
 *  - styled(Button) breaks Button.Text color propagation, so button text is
 *    rendered in an explicit <Text> with the color driven by the variant.
 */
const ButtonFrame = styled(Button, {
  name: 'AppButton',
  borderWidth: 1,
  borderColor: 'transparent',
  // Hover/press feedback is a slight opacity shift only (no background change),
  // applied uniformly across variants. Disabled buttons set pointerEvents=none
  // (see AppButton) so neither fires.
  hoverStyle: { opacity: 0.8 },
  pressStyle: { opacity: 0.7 },
  variants: {
    variant: {
      primary: {
        backgroundColor: '$primary',
        borderColor: '$primary',
        hoverStyle: { backgroundColor: '$primary' },
        pressStyle: { backgroundColor: '$primary' },
      },
      ghost: {
        backgroundColor: 'transparent',
        borderColor: '$primary',
        hoverStyle: { backgroundColor: 'transparent' },
        pressStyle: { backgroundColor: 'transparent' },
      },
      danger: {
        backgroundColor: '$danger',
        borderColor: '$danger',
        hoverStyle: { backgroundColor: '$danger' },
        pressStyle: { backgroundColor: '$danger' },
      },
      light: {
        backgroundColor: '$surface',
        borderColor: '$borderColor',
        hoverStyle: { backgroundColor: '$surface' },
        pressStyle: { backgroundColor: '$surface' },
      },
    },
    size: {
      $3: { height: 35, paddingHorizontal: '$3', borderRadius: '$4' },
      $4: { height: 42, paddingHorizontal: '$4', borderRadius: '$4' },
      $5: { height: 50, paddingHorizontal: '$5', borderRadius: '$6' },
    },
  } as const,
  defaultVariants: { variant: 'primary', size: '$4' },
})

type Variant = 'primary' | 'ghost' | 'danger' | 'light'
type Size = '$3' | '$4' | '$5'

const TEXT_COLOR = {
  primary: '$surface',
  ghost: '$primary',
  danger: '$surface',
  light: '$primary',
} as const
// Font size-token per button size (14/16/18px via the fonts.ts scale), not raw numbers.
const TEXT_SIZE: Record<Size, FontSizeTokens> = { $3: '$4', $4: '$6', $5: '$7' }

export type AppButtonProps = Omit<GetProps<typeof ButtonFrame>, 'children' | 'disabled' | 'icon'> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  /** Optional leading icon (e.g. a lucide icon component); colored to match the variant. */
  icon?: ComponentType<{ size?: number; color?: ColorTokens }>
  children?: ReactNode
}

/**
 * Primary action button. Variant drives both background and text color.
 *
 * @remarks Never pass `disabled` to the underlying Tamagui Button — pass
 * `disabled`/`loading` as props and the component simulates it via opacity +
 * pointerEvents + an onPress guard (UI §5). Text color is controlled by
 * `variant`, not a `color` override.
 *
 * @example
 * <AppButton variant="primary" size="$4" onPress={save}>Save</AppButton>
 */
export const AppButton = forwardRef<TamaguiElement, AppButtonProps>(function AppButton(
  { onPress, disabled, loading, children, icon: Icon, variant = 'primary', size = '$4', ...props },
  ref
) {
  const isDisabled = Boolean(disabled || loading)
  const color = TEXT_COLOR[variant]
  const label =
    typeof children === 'string' ? (
      <Text fontFamily="$body" fontWeight="600" fontSize={TEXT_SIZE[size]} color={color}>
        {children}
      </Text>
    ) : (
      children
    )
  return (
    <ButtonFrame
      ref={ref}
      variant={variant}
      size={size}
      opacity={isDisabled ? 0.6 : 1}
      pointerEvents={isDisabled ? 'none' : 'auto'}
      onPress={(e) => {
        if (onPress && !isDisabled) onPress(e)
      }}
      {...props}
    >
      {loading ? (
        <Spinner color={color} />
      ) : Icon ? (
        <XStack gap="$2" alignItems="center">
          <Icon size={16} color={color} />
          {label}
        </XStack>
      ) : (
        label
      )}
    </ButtonFrame>
  )
})
