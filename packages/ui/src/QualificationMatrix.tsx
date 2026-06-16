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
}

const ROW_LABEL_WIDTH = 200
const CELL_WIDTH = 110

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
}: QualificationMatrixProps) {
  if (rows.length === 0 || cols.length === 0) {
    return <EmptyState title={emptyText} />
  }
  const coverage = Boolean(cellState)
  // Responsive density on small (PHASE-3-POLISH item 1): pin-and-shrink — narrower
  // first column, cells, and checkbox so the wide matrix stays usable on a phone.
  const small = Boolean(useMedia()['max-md'])
  const rowLabelW = small ? 124 : ROW_LABEL_WIDTH
  const cellW = small ? 60 : CELL_WIDTH
  const box = small ? 22 : 28
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} width="100%">
      <YStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden">
        {/* header row */}
        <XStack backgroundColor="$background">
          <XStack width={rowLabelW} paddingVertical="$3" paddingHorizontal="$4">
            <P size={4} weight="b" color="$textSecondary">
              {rowHeader.toUpperCase()}
            </P>
          </XStack>
          {cols.map((c) => (
            <XStack key={c.id} width={cellW} paddingVertical="$3" paddingHorizontal="$2" justifyContent="center">
              <P size={4} weight="b" color="$textSecondary" style={{ textAlign: 'center' }}>
                {c.label}
                {c.marked ? <P size={4} weight="b" color="$warning"> *</P> : null}
              </P>
            </XStack>
          ))}
        </XStack>
        {/* operator rows */}
        {rows.map((r) => (
          <XStack key={r.id} borderTopWidth={1} borderTopColor="$borderColor" backgroundColor="$surface">
            <XStack width={rowLabelW} paddingVertical="$3" paddingHorizontal="$4" alignItems="center" gap="$2">
              <P size={3} color={r.out ? '$textSecondary' : '$textPrimary'}>
                {r.label}
              </P>
              {r.out ? (
                <XStack borderWidth={1} borderColor="$borderColor" borderRadius="$2" paddingHorizontal="$1.5">
                  <P size={5} weight="b" color="$textSecondary">
                    OUT
                  </P>
                </XStack>
              ) : null}
            </XStack>
            {cols.map((c) => {
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
                <XStack key={c.id} width={cellW} paddingVertical="$2" justifyContent="center" alignItems="center">
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
            })}
          </XStack>
        ))}
      </YStack>
    </ScrollView>
  )
}
