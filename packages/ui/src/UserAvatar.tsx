import { Avatar, Text } from 'tamagui'

/** Props for {@link UserAvatar}. */
export interface UserAvatarProps {
  /** Stable identity used to pick the fill color. Falls back to `name`. */
  id?: string
  name?: string
  src?: string | null
  size?: number
}

// Fixed categorical avatar palette (deterministic-fill exception to the
// no-hardcoded-hex rule — these are not theme roles; see UI-ARCHITECTURE §3).
const AVATAR_FILLS = [
  '#2D5BE3',
  '#0891B2',
  '#16A34A',
  '#CA8A04',
  '#DC2626',
  '#DB2777',
  '#7C3AED',
  '#4338CA',
] as const

function pickFill(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_FILLS[h % AVATAR_FILLS.length]
}

function initials(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

/**
 * UserAvatar — round person identity (UI shell spec §4). Renders `avatarUrl` when
 * set; otherwise initials on a deterministic colored fill derived from the user
 * id, so a given user always gets the same color. Used in the TopBar (32px) and
 * the account-menu header (38px).
 *
 * @example
 * <UserAvatar id={user.id} name={user.name} src={user.avatarUrl} size={32} />
 */
export function UserAvatar({ id, name, src, size = 32 }: UserAvatarProps) {
  const fill = pickFill(id || name || '?')
  return (
    <Avatar circular size={size}>
      {src ? <Avatar.Image accessibilityLabel={name} src={src} objectFit="cover" /> : null}
      <Avatar.Fallback justifyContent="center" alignItems="center" style={{ backgroundColor: fill }}>
        <Text fontFamily="$heading" fontWeight="600" fontSize={Math.round(size * 0.42)} color="#FFFFFF">
          {initials(name)}
        </Text>
      </Avatar.Fallback>
    </Avatar>
  )
}
