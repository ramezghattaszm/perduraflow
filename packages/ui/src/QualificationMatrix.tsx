import { useState } from 'react'
import { Check } from '@tamagui/lucide-icons'
import { ScrollView, useMedia, XStack, YStack } from 'tamagui'
import { EmptyState } from './EmptyState'
import { P } from './typography'

/** A labelled axis entry (operator row or certification column). */
export interface MatrixAxis {
  id: string
  label: string
  /** Row (operator): absent this shift → an OUT pill (coverage skin, View 3). */
  out?: boolean
  /** Column (station/cert): requires certification → a `*` marker (coverage skin). */
  marked?: boolean
}

/** Tri-state cell for the coverage skin (View 3): qualified / not / cert-gap. */
export type MatrixCell = 'on' | 'off' | 'gap'

/** Props for {@link QualificationMatrix}. */
export interface QualificationMatrixProps {
  rows: MatrixAxis[]
  cols: MatrixAxis[]
  isOn: (rowId: string, colId: string) => boolean
  onToggle: (rowId: string, colId: string, next: boolean) => void
  /** Header label for the row (operator) column. */
  rowHeader: string
  /** Shown when there are no rows or no columns. */
  emptyText: string
  /** When true, cells render the current state but cannot be toggled (RBAC view-only). */
  readOnly?: boolean
  /**
   * Coverage skin (View 3): when provided, renders a read-only tri-state grid
   * (qualified / not-qualified / cert-gap) instead of the editable checkbox, and
   * shows OUT pills (`row.out`) + `*` markers (`col.marked`). Overrides `isOn`.
   */
  cellState?: (rowId: string, colId: string) => MatrixCell
  /** Outer card border + radius (default true). Set false when wrapped in a `Panel`
   *  that already provides the chrome (full-bleed table). */
  bordered?: boolean
  /** Makes the pinned operator (row) labels selectable — e.g. to set the deictic referent. */
  onRowSelect?: (rowId: string) => void
  /** Selected row id (soft highlight on the pinned label); pairs with `onRowSelect`. */
  selectedRowId?: string | null
}

const ROW_LABEL_WIDTH = 200
const CELL_WIDTH = 110
const HEADER_H = 40

/**
 * QualificationMatrix — operators × certifications checkbox grid (FS6). Rows are
 * operators, columns certifications; a filled cell = the operator holds that
 * certification. Controlled: `isOn(operatorId, certId)` reads state and
 * `onToggle` flips one cell. Horizontally scrolls (no scrollbar) when the column
 * set is wider than the viewport, mirroring DataTable's small-screen behaviour.
 *
 * @example
 * <QualificationMatrix rows={operators} cols={certs} isOn={isOn} onToggle={toggle} rowHeader="Operator" />
 */
export function QualificationMatrix({
  rows,
  cols,
  isOn,
  onToggle,
  rowHeader,
  emptyText,
  readOnly = false,
  cellState,
  bordered = true,
  onRowSelect,
  selectedRowId,
}: QualificationMatrixProps) {
  if (rows.length === 0 || cols.length === 0) {
    return <EmptyState title={emptyText} />
  }
  const coverage = Boolean(cellState)
  // Responsive density on small (PHASE-3-POLISH item 1): pin-and-shrink — narrower
  // first column, cells, and checkbox so the wide matrix stays usable on a phone.
  const small = Boolean(useMedia()['max-md'])
  const rowLabelW = small ? 124 : ROW_LABEL_WIDTH
  const minCellW = small ? 84 : CELL_WIDTH
  const box = small ? 22 : 28
  const rowH = small ? 44 : 52

  // Measure the cert scroll viewport so columns FILL it when there's room (no
  // cramping / empty gap) and the table spans full content when it overflows (so
  // the row separators reach the edge while scrolling). `cellW` = the rendered
  // column width; `innerWidth` = the scrolling table's content width.
  const [viewportW, setViewportW] = useState(0)
  const innerWidth = Math.max(viewportW, cols.length * minCellW)
  const cellW = cols.length > 0 ? innerWidth / cols.length : minCellW

  // One cell (a checkbox / coverage state). Extracted so the scroll region and
  // its rows stay readable.
  const renderCell = (r: MatrixAxis, c: MatrixAxis) => {
    const state: MatrixCell = cellState ? cellState(r.id, c.id) : isOn(r.id, c.id) ? 'on' : 'off'
    // OUT operators can't cover any station regardless of certification —
    // availability overrides qualification: the cell renders unavailable
    // (greyed; a dim check if they hold the cert), never live coverage.
    const unavailable = coverage && Boolean(r.out)
    const fill = unavailable
      ? '$surfaceRaised'
      : state === 'on'
        ? '$primary'
        : state === 'gap'
          ? '$dangerSoft'
          : 'transparent'
    const border = unavailable ? '$borderColor' : state === 'on' ? '$primary' : state === 'gap' ? '$danger' : '$borderColor'
    return (
      <XStack key={c.id} width={cellW} height={rowH} justifyContent="center" alignItems="center">
        <XStack
          onPress={readOnly || coverage ? undefined : () => onToggle(r.id, c.id, state !== 'on')}
          width={box}
          height={box}
          borderRadius="$3"
          borderWidth={1}
          opacity={unavailable ? 0.4 : 1}
          cursor={readOnly || coverage ? 'default' : 'pointer'}
          alignItems="center"
          justifyContent="center"
          backgroundColor={fill}
          borderColor={border}
          hoverStyle={readOnly || coverage ? undefined : { borderColor: '$primary' }}
          pressStyle={readOnly || coverage ? undefined : { opacity: 0.7 }}
          role="checkbox"
          aria-checked={!unavailable && state === 'on'}
          aria-label={`${r.label} — ${c.label}${unavailable ? ' (unavailable)' : ''}`}
        >
          {unavailable ? (
            state === 'on' ? <Check size={16} color="$textSecondary" /> : null
          ) : state === 'on' ? (
            <Check size={18} color="$surface" />
          ) : null}
        </XStack>
      </XStack>
    )
  }

  // The OPERATOR column is pinned; only the certification columns scroll
  // horizontally (header + cells move together). No outer border when `bordered`
  // is false (the wrapping Panel supplies the chrome). The header shares the body
  // background; rows are separated by horizontal lines that span the full width.
  return (
    <XStack
      borderWidth={bordered ? 1 : 0}
      borderColor="$borderColor"
      borderRadius={bordered ? '$4' : '$0'}
      overflow="hidden"
      alignItems="stretch"
    >
      {/* pinned operator column */}
      <YStack borderRightWidth={1} borderRightColor="$borderColor">
        <XStack width={rowLabelW} height={HEADER_H} paddingHorizontal="$4" alignItems="center">
          <P size={5} weight="b" caps color="$textTertiary">
            {rowHeader}
          </P>
        </XStack>
        {rows.map((r) => (
          <XStack
            key={r.id}
            width={rowLabelW}
            height={rowH}
            paddingHorizontal="$4"
            alignItems="center"
            gap="$2"
            borderTopWidth={1}
            borderTopColor="$borderColor"
            backgroundColor={selectedRowId === r.id ? '$primarySoft' : undefined}
            onPress={onRowSelect ? () => onRowSelect(r.id) : undefined}
            cursor={onRowSelect ? 'pointer' : undefined}
            hoverStyle={onRowSelect && selectedRowId !== r.id ? { backgroundColor: '$backgroundHover' } : undefined}
          >
            <P size={3} weight="m" color={r.out ? '$textSecondary' : '$textPrimary'} numberOfLines={1}>
              {r.label}
            </P>
            {r.out ? (
              <XStack borderWidth={1} borderColor="$borderColor" borderRadius="$2" paddingHorizontal="$1.5">
                <P size={5} weight="b" caps color="$textTertiary">
                  OUT
                </P>
              </XStack>
            ) : null}
          </XStack>
        ))}
      </YStack>

      {/* scrolling certification columns (header + cells move together). flex={1}
          bounds the scroll viewport (measured); the table is sized to `innerWidth`
          (= max(viewport, columns)) so columns fill any spare width and the row
          separators span the full content — visible across the whole scroll. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        flex={1}
        onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
      >
        <YStack width={innerWidth}>
          <XStack height={HEADER_H}>
            {cols.map((c) => (
              <XStack key={c.id} width={cellW} paddingHorizontal="$2" alignItems="center" justifyContent="center">
                <P size={5} weight="b" caps color="$textTertiary" numberOfLines={1} style={{ textAlign: 'center' }}>
                  {c.label}
                  {c.marked ? <P size={5} weight="b" color="$warning"> *</P> : null}
                </P>
              </XStack>
            ))}
          </XStack>
          {rows.map((r) => (
            <XStack key={r.id} height={rowH} borderTopWidth={1} borderTopColor="$borderColor">
              {cols.map((c) => renderCell(r, c))}
            </XStack>
          ))}
        </YStack>
      </ScrollView>
    </XStack>
  )
}
