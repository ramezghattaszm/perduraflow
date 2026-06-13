import { Text, styled } from 'tamagui'

/**
 * Typography (UI-ARCHITECTURE.md §4). Two components — `H` (headings) and `P`
 * (body) — drive ALL text. Screens never set raw fontSize/fontWeight; they use
 * <H level={n}> / <P size={n}> with an optional `weight`. Color defaults to the
 * semantic `$textPrimary` token and is overridable per call.
 *
 *   <H level={1}>Title</H>                 36px / 600
 *   <H level={3} weight="h">Section</H>    22px / 700
 *   <P size={4}>Body copy.</P>             14px / 400
 *   <P size={2} weight="b" color="$primary">Emphasis</P>
 */

// level → fontSize + lineHeight (px). 0 is an optional display size.
const HEADING = {
  0: { fontSize: 44, lineHeight: 52 },
  1: { fontSize: 36, lineHeight: 44 },
  2: { fontSize: 28, lineHeight: 34 },
  3: { fontSize: 22, lineHeight: 28 },
  4: { fontSize: 18, lineHeight: 24 },
  5: { fontSize: 16, lineHeight: 22 },
  6: { fontSize: 15, lineHeight: 20 },
} as const

// size → fontSize + lineHeight (px). 6–9 are small utility sizes.
const BODY = {
  1: { fontSize: 18, lineHeight: 26 },
  2: { fontSize: 16, lineHeight: 24 },
  3: { fontSize: 15, lineHeight: 22 },
  4: { fontSize: 14, lineHeight: 20 },
  5: { fontSize: 13, lineHeight: 18 },
  6: { fontSize: 12, lineHeight: 16 },
  7: { fontSize: 11, lineHeight: 15 },
  8: { fontSize: 10, lineHeight: 14 },
  9: { fontSize: 9, lineHeight: 12 },
} as const

// r=400, m=500, b=600, h=700. No light (300).
const weight = {
  r: { fontWeight: '400' },
  m: { fontWeight: '500' },
  b: { fontWeight: '600' },
  h: { fontWeight: '700' },
} as const

/**
 * Heading text. `level` (0–6) sets size + line-height; `weight` (r/m/b/h)
 * overrides weight; color defaults to `$textPrimary`. Screens use `H`/`P` — never
 * raw fontSize/fontWeight (§4).
 *
 * @example
 * <H level={1}>Page title</H>
 * <H level={3} weight="h" color="$primary">Section</H>
 */
export const H = styled(Text, {
  name: 'H',
  fontFamily: '$heading',
  color: '$textPrimary',
  variants: {
    level: HEADING,
    weight,
  } as const,
  defaultVariants: { level: 1, weight: 'b' },
})

/**
 * Body text. `size` (1–9) sets size + line-height; `weight` (r/m/b/h); color
 * defaults to `$textPrimary` (§4).
 *
 * @example
 * <P size={4}>Body copy.</P>
 * <P size={2} weight="b" color="$primary">Emphasis</P>
 */
export const P = styled(Text, {
  name: 'P',
  fontFamily: '$body',
  color: '$textPrimary',
  variants: {
    size: BODY,
    weight,
  } as const,
  defaultVariants: { size: 4, weight: 'r' },
})

export type HVariant = keyof typeof HEADING
export type PVariant = keyof typeof BODY
export type FontWeight = keyof typeof weight
