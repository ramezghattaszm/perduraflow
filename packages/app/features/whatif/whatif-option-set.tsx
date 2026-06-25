import { useState } from 'react'
import type { CostedKpis, WhatIfOption, WhatIfResultDto } from '@perduraflow/contracts'
import {
  NarrationBlock,
  OptionCard,
  RationaleView,
  XStack,
  YStack,
  type NarrationState,
} from '@perduraflow/ui'
import { resolveKey, useTranslation } from '../../i18n'
import { useApplyOption, useNarration } from '../../hooks/useWhatIf'

/** Format a KPI value for display (percent, currency, count). */
function fmtPct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}
function fmtMoney(n: number | null): string {
  return n == null ? '—' : `$${n.toFixed(2)}`
}
function fmtHours(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}h`
}
/** Signed delta vs base, with the "good direction" tone (lower cost/late = up). */
function delta(
  value: number | null,
  base: number | null,
  kind: 'pct' | 'money' | 'count' | 'hours',
  lowerIsBetter: boolean
) {
  if (value == null || base == null) return undefined
  const d = value - base
  if (Math.abs(d) < 1e-9) return { delta: '0', tone: 'neutral' as const }
  const tone = (d < 0 ? lowerIsBetter : !lowerIsBetter) ? ('up' as const) : ('down' as const)
  const sign = d > 0 ? '+' : '−'
  const mag = Math.abs(d)
  const txt =
    kind === 'pct'
      ? `${sign}${Math.round(mag * 100)}%`
      : kind === 'money'
        ? `${sign}$${mag.toFixed(2)}`
        : kind === 'hours'
          ? `${sign}${mag.toFixed(1)}h`
          : `${sign}${Math.round(mag)}`
  return { delta: txt, tone }
}

function kpiCells(k: CostedKpis, base: CostedKpis, t: (k: string, opts?: Record<string, unknown>) => string) {
  return [
    {
      label: t('whatif:kpi.otif'),
      value: fmtPct(k.otif),
      ...delta(k.otif, base.otif, 'pct', false),
    },
    {
      label: t('whatif:kpi.cost'),
      value: fmtMoney(k.costPerUnit),
      ...delta(k.costPerUnit, base.costPerUnit, 'money', true),
    },
    {
      // Headline late metric = firm-late HOURS (the scored quantity → matches the recommendation);
      // order COUNT is the secondary caption. A plan with fewer late orders but a larger total breach
      // correctly shows worse here, so the recommended option no longer looks worse than a rejected one.
      label: t('whatif:kpi.late'),
      value: fmtHours(k.firmLateHours),
      caption: t('whatif:kpi.lateOrders', { count: k.lateOrders }),
      ...delta(k.firmLateHours, base.firmLateHours, 'hours', true),
    },
  ]
}

/** Props for {@link WhatIfOptionSet}. */
export interface WhatIfOptionSetProps {
  result: WhatIfResultDto
  /** Called after an option is applied (e.g. to refresh the board / select the draft). */
  onApplied?: (versionId: string) => void
  /** Preview mode — show options + rationale + narration but hide the per-option Apply
   *  (the scenario launcher applies the real underlying-data change separately). */
  previewOnly?: boolean
}

/**
 * A grounded narration for a single result/mode — its own async, non-blocking call so
 * one card's narration never blocks render and a failure is isolated to that block.
 * `mode:'option'` translates THAT option's rationale; `mode:'across_options'` is the
 * one "why the winner won" summary. Translate-only (the backend grounds it in the
 * stored rationale).
 */
function Narration({
  resultId,
  mode,
  optionId,
  title,
}: { resultId: string; mode: 'option' | 'across_options'; optionId?: string; title: string }) {
  const { t } = useTranslation()
  const q = useNarration(resultId, mode, optionId)
  const state: NarrationState = q.isError
    ? 'unavailable'
    : q.isPending
      ? 'loading'
      : q.data?.status === 'ready'
        ? 'ready'
        : 'unavailable'
  return (
    <NarrationBlock
      state={state}
      prose={q.data?.prose ?? null}
      title={title}
      loadingText={t('whatif:narrationLoading')}
      unavailableText={t('whatif:narrationUnavailable')}
    />
  )
}

/**
 * WhatIfOptionSet — the Cockpit costed-options surface (View 1, D55/A19). Renders the
 * ranked options with their **structured rationale always visible**, a **per-option
 * narration** explaining THAT option (async, non-blocking, isolated failure), and
 * **Apply** (live the moment the rationale exists). The across-options "why the winner
 * won" summary renders **once** at the top, not on every card. Reused by the board
 * change-evaluation and the so-what scene (the fix lives here so it can't recur per-path).
 */
export function WhatIfOptionSet({ result, onApplied, previewOnly }: WhatIfOptionSetProps) {
  const { t } = useTranslation()
  // All options start expanded (open at once) for side-by-side comparison; each still toggles.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(result.options.map((o) => o.id))
  )
  const [appliedId, setAppliedId] = useState<string | null>(null)
  const apply = useApplyOption()
  const feasibleCount = result.options.filter((o) => o.feasible).length

  const optionLabel = (o: WhatIfOption) => resolveKey(o.labelKey)

  const cards = result.options.map((o, idx) => {
    const isRec = o.id === result.recommendedOptionId
    const rationale = o.feasible ? (
      <RationaleView
        factorsTitle={t('whatif:factorsTitle')}
        constraintsTitle={t('whatif:constraintsTitle')}
        comparativesTitle={t('whatif:comparativesTitle')}
        factors={o.rationale.factors.map((f) => ({
          label: resolveKey(f.labelKey),
          detail: resolveKey(f.detailKey, f.detailParams),
          contribution: f.contribution,
          direction: f.direction,
        }))}
        constraints={o.rationale.constraints.map((c) => ({
          label: resolveKey(c.labelKey),
          detail: resolveKey(c.detailKey, c.detailParams),
          binding: c.binding,
          type: c.type,
        }))}
        comparatives={o.rationale.comparatives.map((c) => {
          const other = result.options.find((x) => x.id === c.vsOptionId)
          const driver = c.decidingFactors[0]
          const because = driver
            ? ` — ${t('whatif:drivenBy', { factor: resolveKey(`whatif.factorLabel.${driver.key}`) })}`
            : ''
          return {
            text: `${optionLabel(o)} ${t(`whatif:verdict.${c.verdict}`)} ${other ? optionLabel(other) : c.vsOptionId}${because}.`,
          }
        })}
      />
    ) : undefined
    const isExpanded = expanded.has(o.id)
    const onToggle = () =>
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(o.id)) next.delete(o.id)
        else next.add(o.id)
        return next
      })
    return (
      <YStack
        key={o.id}
        flexGrow={1}
        flexBasis={300}
        minWidth={280}
        maxWidth="100%"
      >
        <OptionCard
          rank={t('whatif:rank', { n: idx + 1 })}
          label={optionLabel(o)}
          recommended={isRec}
          recommendedLabel={t('whatif:recommended')}
          feasible={o.feasible}
          infeasibleReason={o.infeasibleReasonKey ? resolveKey(o.infeasibleReasonKey) : undefined}
          scoreLabel={t('whatif:score')}
          score={o.score}
          kpis={o.feasible ? kpiCells(o.kpis, result.baseKpis, t) : []}
          expanded={isExpanded}
          onToggle={onToggle}
          rationale={rationale}
          narration={
            o.feasible ? (
              <Narration
                resultId={result.id}
                mode="option"
                optionId={o.id}
                title={t('whatif:narrationTitle')}
              />
            ) : undefined
          }
          applyCta={t('whatif:applyCta')}
          appliedLabel={t('whatif:applied')}
          hideApply={previewOnly}
          applying={apply.isPending && apply.variables?.optionId === o.id}
          applied={appliedId === o.id}
          onApply={() => {
            apply.mutateAsync({ resultId: result.id, optionId: o.id }).then((v) => {
              setAppliedId(o.id)
              onApplied?.(v.id)
            })
          }}
        />
      </YStack>
    )
  })

  return (
    <YStack gap="$3">
      {/* The across-options "why the winner won" — ONE place, not on every card. */}
      {feasibleCount >= 2 ? (
        <Narration
          resultId={result.id}
          mode="across_options"
          title={t('whatif:narrationSummaryTitle')}
        />
      ) : null}
      {/* Options side by side — each card flexes to share the row, wrapping to a new line on
          narrow widths; an expanded card just grows its own column (cards stay top-aligned). */}
      <XStack
        flexWrap="wrap"
        gap="$3"
        alignItems="flex-start"
      >
        {cards}
      </XStack>
    </YStack>
  )
}
