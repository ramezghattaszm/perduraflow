import { Text, styled } from 'tamagui'

/**
 * Typography (UI-ARCHITECTURE.md §4). Two components — `H` (headings) and `P`
 * (body) — drive ALL text. Screens never set raw fontSize/fontWeight; they use
 * <H level={…}> / <P size={n}> with an optional `weight`. Color defaults to the
 * semantic `$textPrimary` token and is overridable per call.
 *
 * **One responsive scale (UI §4).** Body is 5 sizes (1–5), identical on web and
 * mobile — primary reading floors at 16 (`size={2}`, the default), the absolute
 * floor is 11 (`size={5}`). Headings are 5 sizes (`display`,1–4); the large end
 * **shrinks on small screens** via the existing `max-md` breakpoint (one scale,
 * no parallel mobile object) while small headings converge (`level={4}` is 18 on
 * both). Mobile keeps body ≥16; only big headings clamp down.
 *
 *   <H level="display">Hero</H>            48px web / 32px small
 *   <H level={1}>Page title</H>            36px web / 28px small
 *   <H level={4}>Small heading</H>         18px both
 *   <P size={2}>Body copy.</P>             16px / 400 (default)
 *   <P size={5} weight="b">Dense label</P> 11px — the floor
 */

// level → fontSize + lineHeight (px). Large headings carry a `$max-md` override
// (the small breakpoint), so display/1/2/3 shrink on phones; `4` converges (18
// on both). One scale — no parallel mobile object (UI §4).
const HEADING = {
  display: { fontSize: 48, lineHeight: 56, '$max-md': { fontSize: 32, lineHeight: 38 } },
  1: { fontSize: 36, lineHeight: 44, '$max-md': { fontSize: 28, lineHeight: 34 } },
  2: { fontSize: 28, lineHeight: 36, '$max-md': { fontSize: 22, lineHeight: 28 } },
  3: { fontSize: 22, lineHeight: 28, '$max-md': { fontSize: 20, lineHeight: 26 } },
  4: { fontSize: 18, lineHeight: 24 },
} as const

// size → fontSize + lineHeight (px). 5 sizes, identical web + mobile. 2 (16) is
// the primary-reading default; 5 (11) is the absolute floor — nothing smaller.
const BODY = {
  1: { fontSize: 18, lineHeight: 26 },
  2: { fontSize: 16, lineHeight: 24 },
  3: { fontSize: 14, lineHeight: 20 },
  4: { fontSize: 12, lineHeight: 16 },
  5: { fontSize: 11, lineHeight: 15 },
} as const

// r=400, m=500, b=600, h=700. No light (300).
const weight = {
  r: { fontWeight: '400' },
  m: { fontWeight: '500' },
  b: { fontWeight: '600' },
  h: { fontWeight: '700' },
} as const

// `caps` bundles UPPERCASE with positive tracking (~0.05em at 11px). The two
// always travel together (UI §4 lock: caps are always letter-spaced, and only
// used at the micro 11px size — table headers, badge codes, meta labels).
const caps = {
  true: { textTransform: 'uppercase', letterSpacing: 0.5 },
} as const

/**
 * Heading text. `level` (`display` | 1–4) sets size + line-height (the large end
 * shrinks on small screens — one responsive scale); `weight` (r/m/b/h) overrides
 * weight; color defaults to `$textPrimary`. Screens use `H`/`P` — never raw
 * fontSize/fontWeight (§4).
 *
 * @example
 * <H level={1}>Page title</H>
 * <H level="display" weight="h" color="$primary">Hero</H>
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
 * Body text. `size` (1–5) sets size + line-height; `weight` (r/m/b/h); color
 * defaults to `$textPrimary` (§4). Default is `2` (16px — the primary-reading
 * floor); `5` (11px) is the absolute floor.
 *
 * @example
 * <P>Body copy.</P>
 * <P size={5} weight="b" color="$primary">Dense label</P>
 * <P size={5} weight="b" caps color="$textTertiary">Column header</P>
 */
export const P = styled(Text, {
  name: 'P',
  fontFamily: '$body',
  color: '$textPrimary',
  variants: {
    size: BODY,
    weight,
    caps,
  } as const,
  defaultVariants: { size: 2, weight: 'r' },
})

export type HVariant = keyof typeof HEADING
export type PVariant = keyof typeof BODY
export type FontWeight = keyof typeof weight
