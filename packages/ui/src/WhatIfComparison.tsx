import type { WhatIfOption, WhatIfResultDto } from '@perduraflow/contracts'
import { ScrollView, XStack, YStack } from 'tamagui'
import { StatusPill } from './StatusPill'
import { P } from './typography'

/** A comparison column = one option (header). */
export interface ComparisonColumn {
  id: string
  label: string
  rank: number
  recommended: boolean
  feasible: boolean
}
/** A comparison row = one metric, its cells aligned to the columns (string-formatted, '—' = n/a). */
export interface ComparisonRow {
  key: string
  label: string
  cells: string[]
}

const fmtPct = (n: number | null): string => (n == null ? '—' : `${Math.round(n * 100)}%`)
const fmtMoney = (n: number | null): string => (n == null ? '—' : `$${n.toFixed(2)}`)
const fmtNum = (n: number | null): string => (n == null ? '—' : String(n))
const fmtHours = (n: number | null): string => (n == null ? '—' : `${n.toFixed(1)}h`)
const factorValue = (o: WhatIfOption, key: string): string => {
  const f = o.rationale.factors.find((x) => x.key === key)
  return f ? String(f.rawValue) : '—'
}

/**
 * Build the side-by-side comparison model **directly from the what-if result** (decide-support #2).
 * Columns are the options; rows are KPIs + the two relative factors (changeovers/displacement) the
 * planner compares. Every cell is read from the artifact (option `kpis` / `rationale.factors`) and
 * formatted here — the number is NEVER produced or retyped by the model (render-don't-retype).
 * Infeasible options show '—' (no schedule to measure). Pure → unit-testable for no-transcription.
 */
export function buildComparison(result: WhatIfResultDto, optionLabel: (o: WhatIfOption) => string): { columns: ComparisonColumn[]; rows: ComparisonRow[] } {
  const columns: ComparisonColumn[] = result.options.map((o) => ({
    id: o.id,
    label: optionLabel(o),
    rank: o.rank,
    recommended: o.id === result.recommendedOptionId,
    feasible: o.feasible,
  }))
  const metric = (key: string, label: string, fn: (o: WhatIfOption) => string): ComparisonRow => ({
    key,
    label,
    cells: result.options.map((o) => (o.feasible ? fn(o) : '—')),
  })
  const rows: ComparisonRow[] = [
    metric('otif', 'OTIF', (o) => fmtPct(o.kpis.otif)),
    metric('cost', 'Cost / unit', (o) => fmtMoney(o.kpis.costPerUnit)),
    // Firm-late HOURS first (the scored quantity → matches the recommendation), order count below it.
    metric('late', 'Firm late', (o) => fmtHours(o.kpis.firmLateHours)),
    metric('lateOrders', 'Late orders', (o) => fmtNum(o.kpis.lateOrders)),
    metric('throughput', 'Throughput', (o) => fmtNum(o.kpis.throughput)),
    metric('changeover', 'Changeovers', (o) => factorValue(o, 'changeover')),
    metric('displacement', 'Displacement', (o) => factorValue(o, 'displacement')),
  ]
  return { columns, rows }
}

/** Props for {@link WhatIfComparison}. */
export interface WhatIfComparisonProps {
  result: WhatIfResultDto
  /** Human option label (i18n resolver from the app); defaults to the raw key. */
  optionLabel?: (o: WhatIfOption) => string
  /** Column labels (recommended / rank chips). */
  recommendedLabel?: string
  rankLabel?: (rank: number) => string
}

const METRIC_W = 132
const COL_W = 128

/**
 * WhatIfComparison — the decide-support **side-by-side** (design §2). A columnar options × KPIs/
 * factors table rendered **directly from the {@link WhatIfResultDto}** (via {@link buildComparison}),
 * the recommended option marked. The conversation renders this on a compare turn and the model
 * narrates the trade-off *around* it — the figures are rendered here, never retyped by the LLM.
 */
export function WhatIfComparison({ result, optionLabel = (o) => o.labelKey, recommendedLabel = 'Recommended', rankLabel = (r) => `#${r}` }: WhatIfComparisonProps) {
  const { columns, rows } = buildComparison(result, optionLabel)
  return (
    <XStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden" alignItems="stretch">
      {/* pinned metric-label column */}
      <YStack borderRightWidth={1} borderRightColor="$borderColor">
        <YStack width={METRIC_W} minHeight={56} paddingHorizontal="$3" justifyContent="center">
          <P size={5} weight="b" caps color="$textTertiary">
            Option
          </P>
        </YStack>
        {rows.map((r) => (
          <XStack key={r.key} width={METRIC_W} height={36} paddingHorizontal="$3" alignItems="center" borderTopWidth={1} borderTopColor="$borderColor">
            <P size={4} color="$textSecondary" numberOfLines={1}>
              {r.label}
            </P>
          </XStack>
        ))}
      </YStack>

      {/* one scrolling column per option (header + cells move together) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <XStack>
          {columns.map((c, ci) => (
            <YStack key={c.id} width={COL_W} borderRightWidth={ci < columns.length - 1 ? 1 : 0} borderRightColor="$borderColor" backgroundColor={c.recommended ? '$primarySoft' : undefined}>
              <YStack minHeight={56} paddingHorizontal="$3" paddingVertical="$2" gap="$1" justifyContent="center">
                <P size={4} weight="m" color="$textPrimary" numberOfLines={1}>
                  {c.label}
                </P>
                <XStack gap="$1.5" alignItems="center">
                  <P size={5} color="$textTertiary">
                    {rankLabel(c.rank)}
                  </P>
                  {c.recommended ? <StatusPill tone="active">{recommendedLabel}</StatusPill> : null}
                  {!c.feasible ? <StatusPill tone="danger">—</StatusPill> : null}
                </XStack>
              </YStack>
              {rows.map((r) => (
                <XStack key={r.key} height={36} paddingHorizontal="$3" alignItems="center" borderTopWidth={1} borderTopColor="$borderColor">
                  <P size={4} weight="m" color="$textPrimary">
                    {r.cells[ci]}
                  </P>
                </XStack>
              ))}
            </YStack>
          ))}
        </XStack>
      </ScrollView>
    </XStack>
  )
}
