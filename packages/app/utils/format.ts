/**
 * Number/currency formatting. `formatCents` is kept in the template even though
 * the PriceTag component was dropped — currency formatting is a common need and
 * a clean example of a shared utility (UI-ARCHITECTURE.md §12).
 */
export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
