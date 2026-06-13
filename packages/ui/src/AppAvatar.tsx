import { Avatar, Text } from 'tamagui'

/**
 * AppAvatar — image with an initials fallback. Sizes use Tamagui size tokens
 * (UI-ARCHITECTURE.md §5), mapped to circle diameters.
 */
const DIAMETER = { $3: 32, $4: 40, $5: 56, $6: 80 } as const
type AvatarSize = keyof typeof DIAMETER

export interface AppAvatarProps {
  src?: string | null
  name?: string
  size?: AvatarSize
}

function initials(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

/**
 * Circular avatar — shows `src` when present, otherwise the name's initials on a
 * `$primaryLight` fallback. `size` uses Tamagui size tokens (§5).
 *
 * @example
 * <AppAvatar src={user.avatarUrl} name={user.name} size="$5" />
 */
export function AppAvatar({ src, name, size = '$4' }: AppAvatarProps) {
  const d = DIAMETER[size]
  return (
    <Avatar circular size={d}>
      {src ? <Avatar.Image accessibilityLabel={name} src={src} /> : null}
      <Avatar.Fallback backgroundColor="$primaryLight" justifyContent="center" alignItems="center">
        <Text fontFamily="$heading" fontWeight="600" fontSize={Math.round(d * 0.4)} color="$surface">
          {initials(name)}
        </Text>
      </Avatar.Fallback>
    </Avatar>
  )
}
