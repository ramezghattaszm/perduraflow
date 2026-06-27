import { ChevronLeft } from '@tamagui/lucide-icons'
import {
  AppButton,
  LatenessChain,
  LearnedParamPanel,
  type MeasuredDetail,
  P,
  type ParamProvenance,
  type PredictedDetail,
  XStack,
  YStack,
} from '@perduraflow/ui'
import type { LearnedParameterDto, ScheduledOperationDto } from '@perduraflow/contracts'
import { useTranslation } from '../../i18n'
import { latenessLines, latenessSummary } from '../../utils/lateness'

/** Round to ≤2 decimals (drops trailing zeros). */
const r2 = (n: number) => Number(n.toFixed(2))
/** HH:MM in UTC (the board's plan clock). */
const fmtTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Props for {@link OpDetailCard}. */
export interface OpDetailCardProps {
  /** The full scheduled operation (carries cycle source, operator, actuals, lateness chain). */
  op: ScheduledOperationDto
  /** The learned cycle parameter for this op's (resource, routing-operation), if any. */
  learned?: LearnedParameterDto
  /** Resolved display names. */
  resourceName: string
  partNo: string
  /** When the op is stranded, the active down-window label (for the schedule rows); else null. */
  strandedWindowLabel?: string | null
  /** Pointer to the resource's wear surface — board-only (the work-list has no lanes); omit to hide. */
  wearPointer?: { label: string; onPress: () => void }
  /** When the order is firm at-risk, the PRIMARY "See options" action — the bounded costed option-set
   *  card (label + press); omit to hide. */
  seeOptions?: { label: string; onPress: () => void }
  /** When the order is firm at-risk, the SECONDARY "Evaluate options" action — open the Copilot for
   *  exploration beyond the bounded set (label + press); omit to hide. */
  evaluateOptions?: { label: string; onPress: () => void }
  /** A "back" affordance shown above the card (e.g. return to the work-list order rollup); omit to hide. */
  onBack?: { label: string; onPress: () => void }
}

/**
 * OpDetailCard — the **one** operation-detail card, shared by the board (a clicked Gantt bar) and the
 * work-list (drilling into an order's op). Renders {@link LearnedParamPanel} from a single op: cycle
 * time + source provenance (learned / pre-adopted / standard), the operator the engine applied (C5),
 * planned-vs-actual performance, an optional wear pointer, and a footer with the causal "why late"
 * chain + the firm-at-risk "Evaluate options" action. The caller resolves the op + its learned record
 * and supplies the two context-specific actions; the card owns all the derivation + styling so the two
 * surfaces can never drift apart.
 */
export function OpDetailCard({ op, learned, resourceName, partNo, strandedWindowLabel, wearPointer, seeOptions, evaluateOptions, onBack }: OpDetailCardProps) {
  const { t } = useTranslation('scheduling')
  const tl = (k: string, o?: Record<string, unknown>): string => t(k, o ?? {})

  // Provenance reflects the cycle the SCHEDULE PLANNED THIS OP WITH (per-op, date-aware) — not the
  // line's live overlay (date-agnostic), which would mislabel an already-run op.
  const opProvenance: ParamProvenance =
    op.cycleSource === 'ml_predicted' ? 'predicted' : op.cycleSource === 'ml_adjusted' ? 'measured' : 'standard'

  let opMeasured: MeasuredDetail | undefined
  if (opProvenance === 'measured' && learned?.source === 'ml_adjusted' && learned.learnedValue != null) {
    const std = learned.stdBaseline
    const lv = learned.learnedValue
    opMeasured = {
      standardText: `${r2(std)}m`,
      learnedText: `${r2(lv)}m`,
      deltaText: `${lv >= std ? '+' : ''}${Math.round(((lv - std) / std) * 100)}%`,
      basisText: t('learned.basis', { count: learned.sampleCount }),
      settledText: t('learned.settled'),
    }
  }

  // Adopted-but-not-applied: a held learned value exists, yet this committed plan still runs standard
  // (stale until re-solve) — distinct from "still accruing".
  const opAdoptedStale = opProvenance === 'standard' && learned?.status === 'held' && learned.learnedValue != null
  const opLearnedDeltaPct =
    learned && learned.learnedValue != null && learned.stdBaseline > 0
      ? Math.round(((learned.learnedValue - learned.stdBaseline) / learned.stdBaseline) * 100)
      : 0

  let opPredicted: PredictedDetail | undefined
  if (opProvenance === 'predicted' && learned?.source === 'ml_predicted' && learned.learnedValue != null) {
    const std = learned.stdBaseline
    const pv = learned.learnedValue
    opPredicted = {
      standardText: `${r2(std)}m`,
      predictedText: `${r2(pv)}m`,
      deltaText: `${pv >= std ? '+' : ''}${Math.round(((pv - std) / std) * 100)}%`,
      basisText: t('learned.predictedBasis'),
      noteText: t('learned.predictedNote'),
    }
  }

  // Performance — planned vs actual; shown WHENEVER the op has actuals (independent of any forecast).
  let perfRows: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }[] | undefined
  if (op.actual) {
    const a = op.actual
    const plannedRun = op.setupTime + op.cycleTime * op.plannedQty
    const actualRun = (new Date(a.actualEnd).getTime() - new Date(a.actualStart).getTime()) / 60_000
    const runDelta = plannedRun > 0 ? (actualRun - plannedRun) / plannedRun : 0
    perfRows = [
      {
        label: t('board.perf.cycle'),
        value: a.actualCycleTime != null ? `${r2(op.cycleTime)} → ${r2(a.actualCycleTime)} min` : '—',
        tone: a.actualCycleTime == null ? undefined : a.actualCycleTime > op.cycleTime ? 'warn' : 'ok',
      },
      {
        label: t('board.perf.run'),
        value: `${Math.round(plannedRun)} → ${Math.round(actualRun)} min (${runDelta >= 0 ? '+' : ''}${Math.round(runDelta * 100)}%)`,
        tone: runDelta > 0.02 ? 'warn' : runDelta < -0.02 ? 'ok' : undefined,
      },
      { label: t('board.perf.output'), value: `${a.goodQty} / ${a.scrapQty}`, tone: a.scrapQty > 0 ? 'bad' : 'ok' },
    ]
  }

  // Operator (C5) — name, performance % (higher = faster), labor rate, and the timing effect. Same
  // source as the engine (server-resolved). The factor scales RUN time (effectiveCycle = cycle / f):
  // 0.85 runs ~18% slower (1/0.85 − 1); 1.10 runs ~9% faster (1 − 1/1.10).
  const opOperator = (() => {
    const o = op.operator
    if (!o) {
      // No named operator pinned → the op ran at STANDARD. The standard cycle already assumes a
      // standard-rate operator (IE standard-time convention); a missing assignment is NOT an unstaffed
      // line. Show the honest standard framing rather than an empty/missing state.
      return {
        label: t('operator.label'),
        name: t('operator.standardName'),
        badge: t('operator.standardBadge'),
        tone: 'neutral' as const,
        effect: t('operator.effectUnassigned'),
        rate: undefined,
      }
    }
    const f = o.performanceFactor
    const pct = Math.round(f * 100)
    const delta = Math.round(Math.abs(1 / f - 1) * 100)
    const effect = f > 1 ? t('operator.effectFaster', { pct, delta }) : f < 1 ? t('operator.effectSlower', { pct, delta }) : t('operator.effectStandard')
    return {
      label: t('operator.label'),
      name: o.name,
      badge: t('operator.ofStandard', { pct }),
      tone: (f > 1 ? 'ok' : f < 1 ? 'warn' : 'neutral') as 'ok' | 'warn' | 'neutral',
      effect,
      rate: o.laborRate != null ? t('operator.rate', { rate: `$${o.laborRate.toFixed(2)}` }) : undefined,
    }
  })()

  const scheduleRows = [
    { label: t('board.tooltip.resource'), value: resourceName || '—' },
    { label: t('board.tooltip.demandLine'), value: op.demandLineId ?? '—' },
    {
      label: t('board.tooltip.scheduled'),
      value: `${fmtTime(new Date(op.plannedStart).getTime())} – ${fmtTime(new Date(op.plannedEnd).getTime())}`,
    },
    // Stranded: the line is down across this op's slot → it can't run as planned.
    ...(strandedWindowLabel ? [{ label: t('board.tooltip.downWindow'), value: strandedWindowLabel }] : []),
    { label: t('board.tooltip.setup'), value: `${Math.round(op.setupTime)} min` },
    { label: t('board.tooltip.run'), value: `${Math.round(op.cycleTime * op.plannedQty)} min` },
  ]

  return (
    <YStack width="100%" gap="$2">
      {onBack ? (
        <XStack onPress={onBack.onPress} cursor="pointer" alignItems="center" gap="$1.5" hoverStyle={{ opacity: 0.7 }}>
          <ChevronLeft size={16} color="$textSecondary" />
          <P size={4} weight="m" color="$textSecondary">
            {onBack.label}
          </P>
        </XStack>
      ) : null}
      <LearnedParamPanel
        operator={opOperator}
      title={`${partNo} · ${resourceName}`}
      subtitle={`op ${op.opSeq}`}
      status={
        op.atRisk
          ? {
              label: op.atRiskReason
                ? t('atRiskWithReason', { reason: t(`riskReason.${op.atRiskReason}`, { defaultValue: op.atRiskReason }) })
                : t('atRisk'),
              tone: 'danger',
            }
          : op.stranded
            ? { label: t('strandedStatus'), tone: 'warning' as const }
            : undefined
      }
      scheduleRows={scheduleRows}
      metricLabel={opProvenance === 'measured' ? t('learned.cycle') : opProvenance === 'predicted' ? t('learned.cyclePredicted') : t('learned.cycleStd')}
      sourceText={opProvenance === 'measured' ? t('source.ml_adjusted') : opProvenance === 'predicted' ? t('source.ml_predicted') : t('source.standard')}
      provenance={opProvenance}
      standardText={`${r2(op.cycleTime)}m`}
      secondary={{ label: t('learned.setupRow'), value: `${op.setupTime}m` }}
      standardNote={
        opAdoptedStale
          ? t('learned.staleAdopted', { delta: opLearnedDeltaPct, count: learned?.sampleCount ?? 0 })
          : learned && learned.sampleCount > 0
            ? t('learned.accruing', { count: learned.sampleCount })
            : t('learned.noAdjustment')
      }
      measured={opMeasured}
      predicted={opPredicted}
      performance={op.actual ? { label: t('board.perf.title'), rows: perfRows, emptyText: t('board.perf.empty') } : undefined}
      wearPointer={wearPointer}
      // The "why late" chain + the firm-at-risk "Evaluate options" action live INSIDE the card.
      footer={(() => {
        if (!op.latenessChain && !seeOptions && !evaluateOptions) return undefined
        return (
          <>
            {op.latenessChain ? (
              <LatenessChain
                title={t('lateness.why')}
                summary={latenessSummary(op.latenessChain, tl)}
                lines={latenessLines(op.latenessChain, tl)}
                expandLabel={t('lateness.expand')}
                collapseLabel={t('lateness.collapse')}
              />
            ) : null}
            {seeOptions || evaluateOptions ? (
              <XStack justifyContent="flex-end" gap="$2">
                {evaluateOptions ? (
                  <AppButton variant="light" size="$3" onPress={evaluateOptions.onPress}>
                    {evaluateOptions.label}
                  </AppButton>
                ) : null}
                {seeOptions ? (
                  <AppButton variant="primary" size="$3" onPress={seeOptions.onPress}>
                    {seeOptions.label}
                  </AppButton>
                ) : null}
              </XStack>
            ) : null}
          </>
        )
      })()}
      />
    </YStack>
  )
}
