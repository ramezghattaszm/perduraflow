import type { ReactNode } from 'react'
import { Spinner, XStack, YStack } from 'tamagui'
import { EmptyState } from './EmptyState'
import { P } from './typography'

/**
 * DataTable — the list view behind every admin CRUD screen. A column-driven,
 * variant-free table (header row + pressable data rows) so screens never
 * re-style a table inline (UI §0.1). Handles loading and empty states.
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
}

/**
 * Column-driven list table with loading and empty states.
 *
 * @example
 * <DataTable columns={[{ key: 'name', label: 'Name' }]} rows={rows} onRowPress={edit} />
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowPress,
  isLoading,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
}: {
  columns: Column<T>[]
  rows: T[]
  onRowPress?: (row: T) => void
  isLoading?: boolean
  emptyTitle?: string
  emptyMessage?: string
}) {
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
    <YStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden">
      <XStack backgroundColor="$background" paddingVertical="$3" paddingHorizontal="$4" gap="$3">
        {columns.map((c) => (
          <YStack key={c.key} width={c.width} flex={c.width ? undefined : (c.flex ?? 1)}>
            <P size={6} weight="b" color="$textSecondary">
              {c.label.toUpperCase()}
            </P>
          </YStack>
        ))}
      </XStack>
      {rows.map((row) => (
        <XStack
          key={row.id}
          paddingVertical="$3"
          paddingHorizontal="$4"
          gap="$3"
          alignItems="center"
          borderTopWidth={1}
          borderTopColor="$borderColor"
          backgroundColor="$surface"
          cursor={onRowPress ? 'pointer' : undefined}
          hoverStyle={onRowPress ? { backgroundColor: '$background' } : undefined}
          onPress={onRowPress ? () => onRowPress(row) : undefined}
        >
          {columns.map((c) => (
            <YStack key={c.key} width={c.width} flex={c.width ? undefined : (c.flex ?? 1)}>
              {c.render ? (
                c.render(row)
              ) : (
                <P size={4} color="$textPrimary">
                  {String((row as Record<string, unknown>)[c.key] ?? '—')}
                </P>
              )}
            </YStack>
          ))}
        </XStack>
      ))}
    </YStack>
  )
}
