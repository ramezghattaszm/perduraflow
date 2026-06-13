import { XStack, YStack, styled } from 'tamagui'

/**
 * AppSwitch — controlled on/off toggle. Disabled is simulated with opacity +
 * pointerEvents (same rule as AppButton), never a disabled prop on a pressable.
 */
const Track = styled(XStack, {
  name: 'AppSwitch',
  alignItems: 'center',
  borderRadius: 999,
  padding: 2,
  variants: {
    checked: {
      true: { backgroundColor: '$primary' },
      false: { backgroundColor: '$borderColor' },
    },
    size: {
      $3: { width: 40, height: 24 },
      $4: { width: 48, height: 28 },
    },
  } as const,
  defaultVariants: { checked: false, size: '$4' },
})

const Thumb = styled(YStack, {
  name: 'AppSwitchThumb',
  backgroundColor: '$surface',
  borderRadius: 999,
  variants: {
    size: {
      $3: { width: 20, height: 20 },
      $4: { width: 24, height: 24 },
    },
  } as const,
  defaultVariants: { size: '$4' },
})

type SwitchSize = '$3' | '$4'

export interface AppSwitchProps {
  checked: boolean
  onCheckedChange?: (next: boolean) => void
  disabled?: boolean
  size?: SwitchSize
}

/**
 * Controlled on/off switch.
 *
 * @remarks Disabled is simulated with opacity + pointerEvents (same rule as
 * AppButton, §5) — there is no native `disabled` prop on the pressable.
 *
 * @example
 * <AppSwitch checked={enabled} onCheckedChange={setEnabled} />
 */
export function AppSwitch({ checked, onCheckedChange, disabled, size = '$4' }: AppSwitchProps) {
  return (
    <Track
      checked={checked}
      size={size}
      justifyContent={checked ? 'flex-end' : 'flex-start'}
      opacity={disabled ? 0.5 : 1}
      pointerEvents={disabled ? 'none' : 'auto'}
      cursor="pointer"
      onPress={() => {
        if (!disabled) onCheckedChange?.(!checked)
      }}
    >
      <Thumb size={size} />
    </Track>
  )
}
