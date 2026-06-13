import { forwardRef, type ReactNode } from 'react'
import {
  Button,
  Spinner,
  Text,
  styled,
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
  variants: {
    variant: {
      primary: { backgroundColor: '$primary', borderColor: '$primary' },
      ghost: { backgroundColor: 'transparent', borderColor: '$primary' },
      danger: { backgroundColor: '$danger', borderColor: '$danger' },
      light: { backgroundColor: '$surface', borderColor: '$borderColor' },
    },
    size: {
      $3: { height: 40, paddingHorizontal: '$3', borderRadius: '$4' },
      $4: { height: 48, paddingHorizontal: '$4', borderRadius: '$4' },
      $5: { height: 56, paddingHorizontal: '$5', borderRadius: '$6' },
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
const TEXT_SIZE: Record<Size, number> = { $3: 14, $4: 16, $5: 18 }

export type AppButtonProps = Omit<GetProps<typeof ButtonFrame>, 'children' | 'disabled'> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
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
  { onPress, disabled, loading, children, variant = 'primary', size = '$4', ...props },
  ref,
) {
  const isDisabled = Boolean(disabled || loading)
  const color = TEXT_COLOR[variant]
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
      ) : typeof children === 'string' ? (
        <Text fontFamily="$body" fontWeight="600" fontSize={TEXT_SIZE[size]} color={color}>
          {children}
        </Text>
      ) : (
        children
      )}
    </ButtonFrame>
  )
})
