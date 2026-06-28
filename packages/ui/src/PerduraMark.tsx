import { Path, Rect, Svg } from 'react-native-svg'

/**
 * Fixed Perdura BRAND colours — the monogram must look identical in light and dark (it's a logo, not UI
 * chrome), exactly matching the favicon / app icon. Intentionally NOT theme tokens (a semantic token
 * would flip with the theme). Re-render the icon assets and update here together if the accent changes.
 */
const BRAND_TEAL = '#0F766E'
const BRAND_WHITE = '#FFFFFF'

/** Props for {@link PerduraMark}. */
export interface PerduraMarkProps {
  /** Rendered square size in px (default 24). */
  size?: number
}

/**
 * PerduraMark — the Perdura monogram (a white "P" on a teal rounded tile), rendered inline as SVG so it
 * is pixel-identical to the favicon / app icon on **both** web and native (no per-platform asset import).
 * The path + radius mirror `IconAssets/perdura-logo/svg/icon-rounded-teal.svg` (viewBox 1024).
 *
 * @example
 * <PerduraMark size={24} />
 */
export function PerduraMark({ size = 24 }: PerduraMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Rect x={0} y={0} width={1024} height={1024} rx={228} ry={228} fill={BRAND_TEAL} />
      <Path
        d="M404 752 L404 272 C 712 272 712 540 404 540"
        fill="none"
        stroke={BRAND_WHITE}
        strokeWidth={132}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
