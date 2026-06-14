import { Building2 } from '@tamagui/lucide-icons'
import { Avatar } from 'tamagui'

/** Props for {@link OrgAvatar}. */
export interface OrgAvatarProps {
  src?: string | null
  name?: string
  /** Circle diameter in px. 34 brand zone, 30 collapsed/small (spec §4). */
  size?: number
}

/**
 * OrgAvatar — round tenant identity (UI shell spec §4). Renders `tenant.logoUrl`
 * cover-fit and circular-clipped when set; otherwise a neutral no-logo
 * placeholder (a building glyph on `$surfaceRaised`) that reads as "organization,
 * no logo set" — never as broken. Real client logos are tenant-supplied at
 * runtime via `logoUrl`; the repo ships only the placeholder (SKIP-53).
 *
 * @example
 * <OrgAvatar src={tenant.logoUrl} name={tenant.name} size={34} />
 */
export function OrgAvatar({ src, name, size = 34 }: OrgAvatarProps) {
  return (
    <Avatar circular size={size}>
      {src ? <Avatar.Image accessibilityLabel={name} src={src} objectFit="cover" /> : null}
      <Avatar.Fallback backgroundColor="$surfaceRaised" justifyContent="center" alignItems="center">
        <Building2 size={Math.round(size * 0.5)} color="$textSecondary" />
      </Avatar.Fallback>
    </Avatar>
  )
}
