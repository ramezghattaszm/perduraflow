/**
 * Shared helpers for the template's bootstrap scripts (init-app, create-app).
 *
 * The slug/bundle rules live here so init-app.ts (the low-level placeholder tool)
 * and create-app.ts (the friendly wrapper) validate identically rather than
 * drifting apart.
 */

/**
 * Slug rule: lowercase, starts with a letter, then letters/digits/hyphens only.
 * This is also the npm scope segment (`@<slug>/*`), so it must be scope-legal.
 */
export const SLUG_RE = /^[a-z][a-z0-9-]*$/

/** Returns true when `slug` is a valid workspace scope segment. */
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

/** Returns true when `bundle` looks like a reverse-DNS id (e.g. com.acme.app). */
export function isValidBundle(bundle: string): boolean {
  return /^[a-z0-9.-]+$/.test(bundle) && bundle.includes('.')
}

/**
 * Derives a default slug from a display name: lowercase, non-alphanumerics
 * collapsed to hyphens, leading non-letters stripped so the result starts with a
 * letter. May return `''` for names with no usable letters — the caller should
 * then require an explicit slug.
 *
 * @example slugify('Acme Corp!') // 'acme-corp'
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // runs of non-alphanumerics → single hyphen
    .replace(/^[^a-z]+/, '') // must start with a letter
    .replace(/-+$/g, '') // no trailing hyphen
}
