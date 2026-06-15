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
  surfaceRaisedLight: '#FFFFFF', // light elevates via border/shadow, = surface
  inkLight: '#1A1A2E',
  slateLight: '#5B6472',
  lineLight: '#E3E8F0',
  navBarLight: '#EEF1F6', // close to bgLight (#F7F8FA), subtly recessed — mirrors dark
  // dark neutrals — Deep Navy (very dark desaturated navy; elevation reads lighter)
  bgDark: '#080B14',
  surfaceDark: '#131926',
  surfaceRaisedDark: '#1A2030', // 3rd elevation layer (menus/popovers/raised header)
  inkDark: '#E6E8EB',
  slateDark: '#9AA3B2',
  lineDark: '#232C3D',
  navBarDark: '#0A1324',
  // status — light
  successLight: '#16A34A',
  dangerLight: '#DC2626',
  warningLight: '#D97706',
  // status — dark (brighter)
  successDark: '#4ADE80',
  dangerDark: '#F87171',
  warningDark: '#FBBF24',
  // translucent + tints
  whiteA18: 'rgba(255,255,255,0.18)',
  whiteA08: 'rgba(255,255,255,0.08)',
  blackA20: 'rgba(0,0,0,0.2)',
  blackA45: 'rgba(0,0,0,0.45)',
  primarySoftLight: 'rgba(45,91,227,0.10)', // selected nav/active row tint
  primarySoftDark: 'rgba(91,141,239,0.14)',
  // ML / learned-value accent (phase 3, FS13) — a distinct violet so a learned op
  // reads differently at a glance from a standard (primary-blue) one.
  mlLight: '#6d4ae0',
  mlDark: '#7c5cff',
  mlSoftLight: 'rgba(109,74,224,0.12)',
  mlSoftDark: 'rgba(124,92,255,0.16)',
  dangerSoftLight: 'rgba(220,38,38,0.12)', // cert-gap cell / behind-plan tint
  dangerSoftDark: 'rgba(248,113,113,0.16)',
  warningSoftLight: 'rgba(217,119,6,0.14)', // tool-wear / caution tint
  warningSoftDark: 'rgba(245,180,84,0.16)',
  hoverFillLight: 'rgba(0,0,0,0.045)', // row / nav-item / icon-button hover
  hoverFillDark: 'rgba(255,255,255,0.05)',
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
  surfaceRaised: palette.surfaceRaisedLight,
  primarySoft: palette.primarySoftLight,
  hoverFill: palette.hoverFillLight,
  ml: palette.mlLight,
  mlSoft: palette.mlSoftLight,
  dangerSoft: palette.dangerSoftLight,
  warningSoft: palette.warningSoftLight,
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
  surfaceRaised: palette.surfaceRaisedDark,
  primarySoft: palette.primarySoftDark,
  hoverFill: palette.hoverFillDark,
  ml: palette.mlDark,
  mlSoft: palette.mlSoftDark,
  dangerSoft: palette.dangerSoftDark,
  warningSoft: palette.warningSoftDark,
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
