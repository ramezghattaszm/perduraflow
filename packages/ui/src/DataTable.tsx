import { type ReactNode, useMemo, useState } from 'react'
import { ScrollView, Spinner, XStack, YStack } from 'tamagui'
import { EmptyState } from './EmptyState'
import { P } from './typography'

/**
 * DataTable — the list view behind every admin CRUD screen. A column-driven,
 * variant-free table (header row + pressable data rows) so screens never
 * re-style a table inline (UI §0.1). Handles loading and empty states, and
 * per-column sorting: mark a column `sortable` and its header toggles
 * asc → desc → unsorted on click.
 *
 * @example
 * <DataTable columns={cols} rows={plants} onRowPress={edit} isLoading={isLoading} />
 */
export interface Column<T> {
  key: string
  label: string
  /** Optional custom cell renderer; defaults to String(row[key]). */
  render?: (row: T) => ReactNode
  width?: number
  flex?: number
  /** Allow clicking this column's header to sort by it. */
  sortable?: boolean
  /** Value to sort by when `sortable` (defaults to `row[key]`). Use when the
   *  displayed value differs from the sortable value (e.g. an id shown as a name). */
  sortValue?: (row: T) => string | number | boolean | null | undefined
}

type SortDir = 'asc' | 'desc'
type SortState = { key: string; dir: SortDir } | null

// Exact-layout constants. Columns get a computed pixel width (not flex) so every
// row's cells line up: inside a horizontal ScrollView the table has no definite
// main-axis size, so flexGrow has no shared free space to divide and each row
// would size to its own content. PAD_X / GAP / BORDER must match the row styles.
const PAD_X = 16 // row paddingHorizontal
const GAP = 12 // inter-column gap
const BORDER = 1 // table border width

type SortPrimitive = string | number | boolean | null | undefined

/** Type-aware compare; nullish sorts last. Strings compare numerically + case-insensitively. */
function compareValues(a: SortPrimitive, b: SortPrimitive): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Column-driven list table with loading/empty states and optional per-column sort.
 *
 * @example
 * <DataTable columns={[{ key: 'name', label: 'Name', sortable: true }]} rows={rows} onRowPress={edit} />
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowPress,
  isLoading,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  minRowWidth = 720,
}: {
  columns: Column<T>[]
  rows: T[]
  onRowPress?: (row: T) => void
  isLoading?: boolean
  emptyTitle?: string
  emptyMessage?: string
  /** Min table width before the row scrolls horizontally on small screens (UI shell spec §7). */
  minRowWidth?: number
}) {
  const [sort, setSort] = useState<SortState>(null)

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key && c.sortable)
    if (!col) return rows
    const valueOf = (row: T): SortPrimitive =>
      col.sortValue
        ? col.sortValue(row)
        : ((row as Record<string, unknown>)[col.key] as SortPrimitive)
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sign * compareValues(valueOf(a), valueOf(b)))
  }, [rows, sort, columns])

  // Click a sortable header: asc → desc → unsorted; switching column starts at asc.
  const toggleSort = (key: string) =>
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })

  // Measure the scroll viewport, then size every column in exact pixels. The
  // table fills the viewport when it fits, else holds `minRowWidth` and scrolls.
  const [viewportWidth, setViewportWidth] = useState(0)
  const tableWidth = Math.max(viewportWidth, minRowWidth)
  const colWidths = useMemo(() => {
    const flexCols = columns.filter((c) => !c.width)
    const fixedTotal = columns.reduce((sum, c) => sum + (c.width ?? 0), 0)
    const flexTotal = flexCols.reduce((sum, c) => sum + (c.flex ?? 1), 0) || 1
    const free = Math.max(0, tableWidth - BORDER * 2 - PAD_X * 2 - GAP * (columns.length - 1) - fixedTotal)
    return columns.map((c) => c.width ?? (free * (c.flex ?? 1)) / flexTotal)
  }, [columns, tableWidth])

  if (isLoading) {
    return (
      <YStack padding="$6" alignItems="center">
        <Spinner color="$primary" />
      </YStack>
    )
  }
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} subtitle={emptyMessage} />
  }

  return (
    // Horizontal-scroll wrapper: at `small` the table keeps all columns at
    // `minRowWidth` and scrolls (no scrollbar) instead of dropping columns (UI shell spec §7).
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      width="100%"
      onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}
    >
      <YStack
        width={tableWidth}
        borderWidth={BORDER}
        borderColor="$borderColor"
        borderRadius="$4"
        overflow="hidden"
      >
        <XStack backgroundColor="$surface" paddingVertical="$3" paddingHorizontal={PAD_X}>
          {columns.map((c, i) => {
            const active = sort?.key === c.key
            const indicator = active ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''
            return (
              <XStack
                key={c.key}
                width={colWidths[i]}
                marginRight={i < columns.length - 1 ? GAP : 0}
                overflow="hidden"
                alignItems="center"
                cursor={c.sortable ? 'pointer' : undefined}
                hoverStyle={c.sortable ? { opacity: 0.7 } : undefined}
                onPress={c.sortable ? () => toggleSort(c.key) : undefined}
              >
                <P size={6} weight="b" color={active ? '$primary' : '$textSecondary'}>
                  {c.label.toUpperCase()}
                  {indicator}
                </P>
              </XStack>
            )
          })}
        </XStack>
        {sortedRows.map((row) => (
          <XStack
            key={row.id}
            paddingVertical="$3"
            paddingHorizontal={PAD_X}
            alignItems="center"
            borderTopWidth={1}
            borderTopColor="$borderColor"
            backgroundColor="$background"
            cursor={onRowPress ? 'pointer' : undefined}
            hoverStyle={onRowPress ? { backgroundColor: '$surface' } : undefined}
            onPress={onRowPress ? () => onRowPress(row) : undefined}
          >
            {columns.map((c, i) => {
              const content: ReactNode = c.render
                ? c.render(row)
                : String((row as Record<string, unknown>)[c.key] ?? '—')
              return (
                <YStack
                  key={c.key}
                  width={colWidths[i]}
                  marginRight={i < columns.length - 1 ? GAP : 0}
                  overflow="hidden"
                >
                  {/* Wrap raw text so a string-returning `render` never lands directly in a View. */}
                  {typeof content === 'string' || typeof content === 'number' ? (
                    <P size={4} color="$textPrimary">
                      {content}
                    </P>
                  ) : (
                    content
                  )}
                </YStack>
              )
            })}
          </XStack>
        ))}
      </YStack>
    </ScrollView>
  )
}
