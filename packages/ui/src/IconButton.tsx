import type { ComponentType } from 'react'
import { type ColorTokens, XStack } from 'tamagui'

/** Props for {@link IconButton}. */
export interface IconButtonProps {
  icon: ComponentType<{ size?: number; color?: ColorTokens }>
  label: string
  onPress?: () => void
  /** Glyph size in px. Default 20. */
  iconSize?: number
  color?: ColorTokens
  active?: boolean
  /** Dimmed + non-interactive (e.g. a stepper arrow at its range edge). */
  disabled?: boolean
}

/**
 * IconButton — a square, borderless icon affordance for chrome (TopBar collapse /
 * menu / bell, etc.). Hover uses `$hoverFill`; web gets `role`/`aria-label` so the
 * glyph is announced. Pass a lucide icon component as `icon` (keeps the icon set
 * a caller concern at the app edge, like AppButton).
 *
 * @example
 * <IconButton icon={Menu} label="Open menu" onPress={openDrawer} />
 */
export function IconButton({ icon: Icon, label, onPress, iconSize = 20, color = '$textSecondary', active, disabled }: IconButtonProps) {
  return (
    <XStack
      onPress={disabled ? undefined : onPress}
      cursor={disabled ? 'default' : 'pointer'}
      opacity={disabled ? 0.35 : 1}
      pointerEvents={disabled ? 'none' : 'auto'}
      width={36}
      height={36}
      borderRadius="$4"
      alignItems="center"
      justifyContent="center"
      backgroundColor={active ? '$primarySoft' : 'transparent'}
      hoverStyle={disabled ? undefined : { backgroundColor: active ? '$primarySoft' : '$hoverFill' }}
      pressStyle={disabled ? undefined : { opacity: 0.7 }}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
    >
      <Icon size={iconSize} color={active ? '$primary' : color} />
    </XStack>
  )
}
