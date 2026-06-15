import { Check } from '@tamagui/lucide-icons'
import { ScrollView, XStack, YStack } from 'tamagui'
import { EmptyState } from './EmptyState'
import { P } from './typography'

/** A labelled axis entry (operator row or certification column). */
export interface MatrixAxis {
  id: string
  label: string
}

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
}: QualificationMatrixProps) {
  if (rows.length === 0 || cols.length === 0) {
    return <EmptyState title={emptyText} />
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} width="100%">
      <YStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden">
        {/* header row */}
        <XStack backgroundColor="$background">
          <XStack width={ROW_LABEL_WIDTH} paddingVertical="$3" paddingHorizontal="$4">
            <P size={6} weight="b" color="$textSecondary">
              {rowHeader.toUpperCase()}
            </P>
          </XStack>
          {cols.map((c) => (
            <XStack key={c.id} width={CELL_WIDTH} paddingVertical="$3" paddingHorizontal="$2" justifyContent="center">
              <P size={6} weight="b" color="$textSecondary" style={{ textAlign: 'center' }}>
                {c.label}
              </P>
            </XStack>
          ))}
        </XStack>
        {/* operator rows */}
        {rows.map((r) => (
          <XStack key={r.id} borderTopWidth={1} borderTopColor="$borderColor" backgroundColor="$surface">
            <XStack width={ROW_LABEL_WIDTH} paddingVertical="$3" paddingHorizontal="$4" alignItems="center">
              <P size={4} color="$textPrimary">
                {r.label}
              </P>
            </XStack>
            {cols.map((c) => {
              const on = isOn(r.id, c.id)
              return (
                <XStack key={c.id} width={CELL_WIDTH} paddingVertical="$2" justifyContent="center" alignItems="center">
                  <XStack
                    onPress={readOnly ? undefined : () => onToggle(r.id, c.id, !on)}
                    width={28}
                    height={28}
                    borderRadius="$3"
                    borderWidth={1}
                    cursor={readOnly ? 'default' : 'pointer'}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={on ? '$primary' : 'transparent'}
                    borderColor={on ? '$primary' : '$borderColor'}
                    hoverStyle={readOnly ? undefined : { borderColor: '$primary' }}
                    pressStyle={readOnly ? undefined : { opacity: 0.7 }}
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${r.label} — ${c.label}`}
                  >
                    {on ? <Check size={18} color="$surface" /> : null}
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
