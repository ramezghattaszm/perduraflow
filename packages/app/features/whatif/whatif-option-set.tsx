import { useEffect, useMemo, useState } from 'react'
import type { CostedKpis, WhatIfOption, WhatIfResultDto } from '@perduraflow/contracts'
import {
  NarrationBlock,
  OptionCard,
  RationaleView,
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
/** Signed delta vs base, with the "good direction" tone (lower cost/late = up). */
function delta(value: number | null, base: number | null, kind: 'pct' | 'money' | 'count', lowerIsBetter: boolean) {
  if (value == null || base == null) return undefined
  const d = value - base
  if (Math.abs(d) < 1e-9) return { delta: '0', tone: 'neutral' as const }
  const tone = (d < 0 ? lowerIsBetter : !lowerIsBetter) ? ('up' as const) : ('down' as const)
  const sign = d > 0 ? '+' : '−'
  const mag = Math.abs(d)
  const txt = kind === 'pct' ? `${sign}${Math.round(mag * 100)}%` : kind === 'money' ? `${sign}$${mag.toFixed(2)}` : `${sign}${Math.round(mag)}`
  return { delta: txt, tone }
}

function kpiCells(k: CostedKpis, base: CostedKpis, t: (k: string) => string) {
  return [
    { label: t('whatif:kpi.otif'), value: fmtPct(k.otif), ...delta(k.otif, base.otif, 'pct', false) },
    { label: t('whatif:kpi.cost'), value: fmtMoney(k.costPerUnit), ...delta(k.costPerUnit, base.costPerUnit, 'money', true) },
    { label: t('whatif:kpi.late'), value: String(k.lateOrders), ...delta(k.lateOrders, base.lateOrders, 'count', true) },
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
 * WhatIfOptionSet — the Cockpit costed-options surface (View 1, D55/A19). Renders the
 * ranked options with their **structured rationale always visible**, the **narration
 * alongside** (fetched async, non-blocking), and **Apply** (live the moment the
 * rationale exists). Maps the contract DTOs (i18n keys + params) to resolved UI props
 * via {@link resolveKey}. Reused by the board change-evaluation and the so-what scene.
 */
export function WhatIfOptionSet({ result, onApplied, previewOnly }: WhatIfOptionSetProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<string | null>(result.recommendedOptionId)
  const [appliedId, setAppliedId] = useState<string | null>(null)
  const narrate = useNarration()
  const apply = useApplyOption()
  const [narrState, setNarrState] = useState<NarrationState>('idle')
  const [prose, setProse] = useState<string | null>(null)

  // Narrate the across-options summary once the result exists (async, non-blocking).
  useEffect(() => {
    let cancelled = false
    setNarrState('loading')
    setProse(null)
    narrate
      .mutateAsync({ resultId: result.id, mode: 'across_options' })
      .then((n) => {
        if (cancelled) return
        setNarrState(n.status === 'ready' ? 'ready' : 'unavailable')
        setProse(n.prose ?? null)
      })
      .catch(() => {
        if (!cancelled) setNarrState('unavailable')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id])

  const optionLabel = (o: WhatIfOption) => resolveKey(o.labelKey)

  return (
    <YStack gap="$3">
      {result.options.map((o, idx) => {
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
              const because = driver ? ` — ${t('whatif:drivenBy', { factor: resolveKey(`whatif.factorLabel.${driver.key}`) })}` : ''
              return { text: `${optionLabel(o)} ${t(`whatif:verdict.${c.verdict}`)} ${other ? optionLabel(other) : c.vsOptionId}${because}.` }
            })}
          />
        ) : undefined
        return (
          <OptionCard
            key={o.id}
            rank={t('whatif:rank', { n: idx + 1 })}
            label={optionLabel(o)}
            recommended={isRec}
            recommendedLabel={t('whatif:recommended')}
            feasible={o.feasible}
            infeasibleReason={o.infeasibleReasonKey ? resolveKey(o.infeasibleReasonKey) : undefined}
            scoreLabel={t('whatif:score')}
            score={o.score}
            kpis={o.feasible ? kpiCells(o.kpis, result.baseKpis, t) : []}
            expanded={expanded === o.id}
            onToggle={() => setExpanded(expanded === o.id ? null : o.id)}
            rationale={rationale}
            narration={
              <NarrationBlock
                state={narrState}
                prose={prose}
                title={t('whatif:narrationTitle')}
                loadingText={t('whatif:narrationLoading')}
                unavailableText={t('whatif:narrationUnavailable')}
                note={t('whatif:narrationNote')}
              />
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
        )
      })}
    </YStack>
  )
}
