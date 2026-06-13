import { createInterFont } from '@tamagui/font-inter'

// Inter across the app. Weights used by the H/P system (UI-ARCHITECTURE.md §4):
// r=400, m=500, b=600, h=700. No Inter Light (300) — unreliable cross-platform.
const face = {
  400: { normal: 'Inter' },
  500: { normal: 'InterMedium' },
  600: { normal: 'InterSemiBold' },
  700: { normal: 'InterBold' },
} as const

// Size token scale ($1–$16) for any Tamagui component that reads `$size`.
// H/P set explicit pixel sizes via variants, so this is only the fallback scale.
const size = {
  1: 11, 2: 12, 3: 13, 4: 14, 5: 15, 6: 16, 7: 18, 8: 20,
  9: 22, 10: 24, 11: 28, 12: 32, 13: 36, 14: 44, 15: 52, 16: 64,
} as const

// No letterSpacing anywhere — negative tracking caused glyph overlap on web
// (UI-ARCHITECTURE.md §4). Zero it across the scale.
const letterSpacing = Object.fromEntries(
  Object.keys(size).map((k) => [k, 0]),
) as Record<keyof typeof size, number>

export const headingFont = createInterFont({ face, size, letterSpacing })
export const bodyFont = createInterFont({ face, size, letterSpacing })
