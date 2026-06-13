import { defaultConfig } from '@tamagui/config/v5'
import { createTamagui } from 'tamagui'
import { bodyFont, headingFont } from './fonts'
import { animationsApp } from './animationsApp'

/**
 * Two-layer color system (UI-ARCHITECTURE.md §3).
 *
 * Layer 1 — palette: raw values with neutral names, split into light/dark. This
 * is the ONLY place hex lives. Rebranding is an edit to this object alone.
 *
 * Layer 2 — semantic roles (lightColors / darkColors): the names components
 * reference (`$primary`, `$surface`, …). Both themes define EVERY role.
 *
 * Dark mode follows modern standards (UI §3 "Light & dark themes"): no pure
 * black/white, raised surfaces lighter than the background (elevation via
 * lightness), accents lightened/desaturated for legibility, WCAG-contrast text.
 */
const palette = {
  // brand blues
  brandBlue: '#2D5BE3',
  brandBlueLight: '#7EB3FF',
  brandBlueDark: '#5B8DEF', // primary on dark (lightened)
  brandBlueDarkLight: '#93B4F5',
  // gradients
  gradTopLight: '#C8E6FF',
  gradBottomLight: '#4A6FE3',
  gradTopDark: '#1E2A4A',
  gradBottomDark: '#1E3A8A',
  // light neutrals
  bgLight: '#F7F8FA',
  surfaceLight: '#FFFFFF',
  inkLight: '#1A1A2E',
  slateLight: '#5B6472',
  lineLight: '#E3E8F0',
  navBarLight: '#00429E',
  // dark neutrals (very dark desaturated navy; surface lighter than bg)
  bgDark: '#0B0F1A',
  surfaceDark: '#161B26',
  inkDark: '#E6E8EB',
  slateDark: '#9AA3B2',
  lineDark: '#232A36',
  navBarDark: '#0B1730',
  // status — light
  successLight: '#16A34A',
  dangerLight: '#DC2626',
  warningLight: '#D97706',
  // status — dark (brighter)
  successDark: '#4ADE80',
  dangerDark: '#F87171',
  warningDark: '#FBBF24',
  // translucent
  whiteA18: 'rgba(255,255,255,0.18)',
  whiteA08: 'rgba(255,255,255,0.08)',
  blackA20: 'rgba(0,0,0,0.2)',
  blackA45: 'rgba(0,0,0,0.45)',
} as const

// Layer 2 — semantic roles. Core (12) + extended (3). Every role defined in both.
const lightColors = {
  // --- Core ---
  primary: palette.brandBlue,
  primaryLight: palette.brandBlueLight,
  surface: palette.surfaceLight,
  background: palette.bgLight,
  textPrimary: palette.inkLight,
  textSecondary: palette.slateLight,
  borderColor: palette.lineLight,
  success: palette.successLight,
  danger: palette.dangerLight,
  warning: palette.warningLight,
  gradientStart: palette.gradTopLight,
  gradientEnd: palette.gradBottomLight,
  // --- Extended ---
  surfaceGhost: palette.whiteA18,
  overlay: palette.blackA20,
  navBar: palette.navBarLight,
} as const

const darkColors = {
  // --- Core ---
  primary: palette.brandBlueDark,
  primaryLight: palette.brandBlueDarkLight,
  surface: palette.surfaceDark,
  background: palette.bgDark,
  textPrimary: palette.inkDark,
  textSecondary: palette.slateDark,
  borderColor: palette.lineDark,
  success: palette.successDark,
  danger: palette.dangerDark,
  warning: palette.warningDark,
  gradientStart: palette.gradTopDark,
  gradientEnd: palette.gradBottomDark,
  // --- Extended ---
  surfaceGhost: palette.whiteA08,
  overlay: palette.blackA45,
  navBar: palette.navBarDark,
} as const

export const config = createTamagui({
  ...defaultConfig,
  animations: animationsApp,
  fonts: {
    body: bodyFont,
    heading: headingFont,
  },
  // Override the built-in light/dark themes with the semantic roles. No
  // slug-named theme and no child themes (UI-ARCHITECTURE.md §3): every color
  // is a named semantic token; dark mode is a single theme swap. `color-scheme`
  // is applied per theme on the web by @tamagui/next-theme (enableColorScheme).
  themes: {
    ...defaultConfig.themes,
    light: {
      ...defaultConfig.themes.light,
      ...lightColors,
    },
    dark: {
      ...defaultConfig.themes.dark,
      ...darkColors,
    },
  },
  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
  },
})

export type Conf = typeof config

declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}
}
