'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { TriangleAlert } from '@tamagui/lucide-icons'
import type { GanttBar, VarianceChip } from '@perduraflow/ui'
import {
  AppButton,
  BarDetailSheet,
  ContextSelectors,
  LearnedParamPanel,
  P,
  PageHeader,
  ScheduleGantt,
  StatusPill,
  VarianceStrip,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { usePlants } from '../../../hooks/useOrg'
import { usePlantSelection } from '../../../hooks/usePlantSelection'
import { useParts } from '../../../hooks/useMasterData'
import {
  useCommitSchedule,
  useScheduleResources,
  useScheduleVersion,
  useScheduleVersions,
  useSolveSchedule,
} from '../../../hooks/useScheduling'
import { useLearnedParameters, usePredictions, useVariance } from '../../../hooks/useLearning'
import { useToast } from '../../../hooks/useToast'
import { AdminShell } from '../../shell/admin-shell'

/** Cycle deviation (learned vs std) at/above which a tool-wear flag is shown (mirrors RULE.STEP_BAND). */
const WEAR_PCT = 0.05
/** Behind-plan fraction at/above which a calm lane chip appears (BOARD-SIGNALS item 2). */
const BEHIND_PCT = 0.05

/**
 * Board body (shell-agnostic) — selectors, run strip, Gantt. Rendered inside the
 * web `AdminShell` by {@link BoardScreen} and directly inside the Expo native
 * Stack on iPad (the board is iPad-first-class, FS9), so it must not depend on
 * web-only shell chrome.
 */
export function BoardContent() {
  const { t } = useTranslation(['scheduling', 'admin', 'masterData'])
  const { data: plants = [] } = usePlants()
  const { data: parts = [] } = useParts()
  const { plantId, setPlant } = usePlantSelection(plants)
  const [versionId, setVersionId] = useState<string | null>(null)

  const { data: versions = [] } = useScheduleVersions(plantId ?? undefined)
  const { data: resources = [] } = useScheduleResources(plantId ?? undefined)
  const { data: detail } = useScheduleVersion(versionId ?? undefined)
  const { data: variance } = useVariance(versionId ?? undefined)
  const { data: learned = [] } = useLearnedParameters()
  const { data: predictions = [] } = usePredictions()
  const solve = useSolveSchedule()
  const commit = useCommitSchedule()
  const [selectedBarId, setSelectedBarId] = useState<string | null>(null)
  const { showToast } = useToast()
  const wearShown = useRef<Set<string>>(new Set())

  // default/repair version selection: newest committed, else newest
  useEffect(() => {
    if (versions.length === 0) {
      setVersionId(null)
      return
    }
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      const committed = versions.find((v) => v.status === 'committed')
      setVersionId((committed ?? versions[0]!).id)
    }
  }, [versions, versionId])

  const partNo = useMemo(() => new Map(parts.map((p) => [p.id, p.partNo])), [parts])
  const partColour = useMemo(() => new Map(parts.map((p) => [p.id, p.colour])), [parts])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const versionOptions = versions.map((v) => ({
    value: v.id,
    label: `${t(`status.${v.status}`)} · ${new Date(v.createdAt).toLocaleString()}`,
  }))

  // Changeover markers (render-only): per resource, an op whose part's changeover
  // attribute (colour, the seed driver) differs from the previous op's. Derived
  // from data already on the board — no contract/data change.
  const changeoverIds = useMemo(() => {
    const ids = new Set<string>()
    const ops = [...(detail?.operations ?? [])].sort((a, b) =>
      a.resourceId === b.resourceId ? a.sequencePosition - b.sequencePosition : a.resourceId < b.resourceId ? -1 : 1,
    )
    let prevRes: string | null = null
    let prevColour: string | null | undefined = null
    for (const o of ops) {
      const colour = partColour.get(o.partId)
      if (o.resourceId === prevRes && colour != null && prevColour != null && colour !== prevColour) ids.add(o.id)
      prevRes = o.resourceId
      prevColour = colour
    }
    return ids
  }, [detail, partColour])

  const bars: GanttBar[] = (detail?.operations ?? []).map((o) => {
    const ml = o.cycleSource === 'ml_adjusted' || o.setupSource === 'ml_adjusted'
    return {
      id: o.id,
      resourceId: o.resourceId,
      demandLineId: o.demandLineId,
      label: partNo.get(o.partId) ?? o.partId.slice(0, 6),
      sourceTag: t(`source.${o.cycleSource}`),
      startMs: new Date(o.plannedStart).getTime(),
      endMs: new Date(o.plannedEnd).getTime(),
      setupMin: o.setupTime,
      runMin: o.cycleTime * o.plannedQty,
      atRisk: o.atRisk,
      changeover: changeoverIds.has(o.id),
      ml,
      confidence: o.cycleConfidence ?? o.setupConfidence,
    }
  })
  // Per-resource behind-plan chip (BOARD-SIGNALS item 2): the variance is about the
  // resource, so it lives on the lane. Threshold-gated + settled; per the selected
  // version's actuals (a clean version → none).
  const behindByResource = new Map(
    (variance?.resources ?? [])
      .filter((r) => r.behindPlanPct >= BEHIND_PCT)
      .map((r) => [r.resourceId, t('variance.behindPlan', { pct: Math.round(r.behindPlanPct * 100) })]),
  )
  // Forward-looking lane flag (phase 4, FS18): a live predicted threshold-crossing on
  // the resource → a calm settled "predicted wear ~HH:MM" chip (when not already behind).
  const predByResource = new Map<string, string>()
  for (const p of predictions) {
    if (p.crossingAt && !predByResource.has(p.resourceId)) {
      predByResource.set(p.resourceId, t('board.predictedWear', { time: fmtTime(new Date(p.crossingAt).getTime()) }))
    }
  }
  // Lane sub-label: don't echo the raw resource_type enum ("Line"); the behind chip
  // (when present) is the meaningful secondary, else the predicted flag, else the name.
  const ganttResources = resources.map((r) => ({
    id: r.id,
    label: r.name,
    behind: behindByResource.get(r.id),
    predicted: predByResource.get(r.id),
  }))
  const resourceName = useMemo(() => new Map(resources.map((r) => [r.id, r.name])), [resources])

  // Learned cycle overlays keyed by (resource, op) — the LearnedParamPanel source.
  const learnedCycleByKey = useMemo(
    () => new Map(learned.filter((l) => l.param === 'cycle').map((l) => [`${l.resourceId}:${l.routingOperationId}`, l])),
    [learned],
  )
  const opById = useMemo(() => new Map((detail?.operations ?? []).map((o) => [o.id, o])), [detail])

  // Variance strip chips — all computed; only meaningful chips show, so a clean
  // pre-drift version (no actuals, no churn, no learned values) shows NONE.
  const varianceChips: VarianceChip[] = useMemo(() => {
    if (!variance) return []
    const chips: VarianceChip[] = []
    const behind = [...variance.resources].sort((a, b) => b.behindPlanPct - a.behindPlanPct)[0]
    if (behind && behind.behindPlanPct > 0.005) {
      chips.push({ label: behind.resourceName, value: t('variance.behindPlan', { pct: Math.round(behind.behindPlanPct * 100) }), tone: 'bad' })
    }
    if (variance.throughputAttainment != null) {
      chips.push({ label: t('variance.throughput'), value: `${Math.round(variance.throughputAttainment * 100)}%`, tone: variance.throughputAttainment >= 0.95 ? 'ok' : 'warn' })
    }
    if (variance.churn != null && variance.churn > 0.005) {
      chips.push({ label: t('variance.churn'), value: variance.churn < 0.34 ? t('variance.churnLow') : variance.churn < 0.67 ? t('variance.churnMed') : t('variance.churnHigh'), tone: variance.churn < 0.34 ? 'warn' : 'bad' })
    }
    if (variance.learnedParamCount > 0) {
      chips.push({ label: t('variance.learnedParams'), value: t('variance.learnedCount', { count: variance.learnedParamCount, total: variance.opCount }), tone: 'ok' })
    }
    return chips
  }, [variance, t])

  // D56 tool-wear flag → toast (once per resource/op while crossed).
  useEffect(() => {
    for (const l of learned) {
      if (l.param !== 'cycle' || l.status !== 'held' || l.learnedValue == null) continue
      const dev = l.stdBaseline > 0 ? (l.learnedValue - l.stdBaseline) / l.stdBaseline : 0
      const key = `${l.resourceId}:${l.routingOperationId}`
      if (dev >= WEAR_PCT && !wearShown.current.has(key)) {
        wearShown.current.add(key)
        showToast(t('wear.body', { resource: resourceName.get(l.resourceId) ?? l.resourceId, pct: `+${Math.round(dev * 100)}` }), {
          title: t('wear.title'),
          type: 'warning',
        })
      }
    }
  }, [learned, resourceName, showToast, t])

  const selectedOp = selectedBarId ? opById.get(selectedBarId) : undefined
  const selectedLearned = selectedOp ? learnedCycleByKey.get(`${selectedOp.resourceId}:${selectedOp.routingOperationId}`) : undefined

  const actionError = solve.error ?? commit.error
  const errorMsg = actionError ? translateError(getApiErrorCode(actionError)) : undefined
  const selectedVersion = versions.find((v) => v.id === versionId)

  // Stale-plan signal (BOARD-SIGNALS item 1): the COMMITTED plan no longer reflects
  // reality — a held learned value exists for an op the committed version still runs
  // on `standard`. Settled (held values don't flicker), per-version, computed. Human
  // re-solves (no auto-re-solve, A18/D26). No toast — a calm persistent state.
  const planStale =
    selectedVersion?.status === 'committed' &&
    (detail?.operations ?? []).some((op) => {
      const l = learnedCycleByKey.get(`${op.resourceId}:${op.routingOperationId}`)
      return !!l && l.status === 'held' && l.learnedValue != null && op.cycleSource === 'standard'
    })

  const onSolve = () => {
    if (!plantId) return
    solve.mutate(plantId, { onSuccess: (v) => setVersionId(v.id) })
  }

  // Self-contained bar detail (identity + learned/std + performance). Identity is
  // repeated so the panel/sheet stands alone (the tap target never assumes a hover).
  const scheduleRows = selectedOp
    ? [
        { label: t('board.tooltip.resource'), value: resourceName.get(selectedOp.resourceId) ?? '—' },
        { label: t('board.tooltip.demandLine'), value: selectedOp.demandLineId ?? '—' },
        {
          label: t('board.tooltip.scheduled'),
          value: `${fmtTime(new Date(selectedOp.plannedStart).getTime())} – ${fmtTime(new Date(selectedOp.plannedEnd).getTime())}`,
        },
        { label: t('board.tooltip.setup'), value: `${Math.round(selectedOp.setupTime)} min` },
        { label: t('board.tooltip.run'), value: `${Math.round(selectedOp.cycleTime * selectedOp.plannedQty)} min` },
      ]
    : []

  // Performance — planned-vs-actual for this op on THIS version (from the version's
  // actuals). Undefined when no actuals → the panel renders "no actuals yet".
  type PerfRow = { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }
  let perfRows: PerfRow[] | undefined
  if (selectedOp?.actual) {
    const a = selectedOp.actual
    const r2 = (n: number) => Number(n.toFixed(2)) // round to ≤2 decimals (drops trailing zeros)
    const plannedRun = selectedOp.setupTime + selectedOp.cycleTime * selectedOp.plannedQty
    const actualRun = (new Date(a.actualEnd).getTime() - new Date(a.actualStart).getTime()) / 60_000
    const runDelta = plannedRun > 0 ? (actualRun - plannedRun) / plannedRun : 0
    perfRows = [
      {
        label: t('board.perf.cycle'),
        value: a.actualCycleTime != null ? `${r2(selectedOp.cycleTime)} → ${r2(a.actualCycleTime)} min` : '—',
        tone: a.actualCycleTime == null ? undefined : a.actualCycleTime > selectedOp.cycleTime ? 'warn' : 'ok',
      },
      {
        label: t('board.perf.run'),
        value: `${Math.round(plannedRun)} → ${Math.round(actualRun)} min (${runDelta >= 0 ? '+' : ''}${Math.round(runDelta * 100)}%)`,
        tone: runDelta > 0.02 ? 'warn' : runDelta < -0.02 ? 'ok' : undefined,
      },
      { label: t('board.perf.output'), value: `${a.goodQty} / ${a.scrapQty}`, tone: a.scrapQty > 0 ? 'bad' : 'ok' },
    ]
  }

  // Forward-looking prediction block for the selected op (phase 4, FS18) — a settled
  // statement when this (resource, op) has a live cycle forecast.
  const selPred = selectedOp
    ? predictions.find((p) => p.resourceId === selectedOp.resourceId && p.routingOperationId === selectedOp.routingOperationId && p.param === 'cycle')
    : undefined
  const predictionText =
    selPred && selPred.crossingAt
      ? t('board.pred.panel', {
          crossing: fmtTime(new Date(selPred.crossingAt).getTime()),
          conf: Math.round(selPred.confidence * 100),
          horizon: selPred.horizonMinutes >= 60 ? `${Math.round((selPred.horizonMinutes / 60) * 10) / 10}h` : `${selPred.horizonMinutes}m`,
        })
      : undefined

  const detailPanel = selectedOp ? (
    selectedLearned && selectedLearned.status === 'held' && selectedLearned.learnedValue != null ? (
      <LearnedParamPanel
        title={`${partNo.get(selectedOp.partId) ?? selectedOp.partId} · ${resourceName.get(selectedOp.resourceId) ?? ''}`}
        subtitle={`op ${selectedOp.opSeq}`}
        status={selectedOp.atRisk ? { label: t('atRisk'), tone: 'danger' } : undefined}
        scheduleRows={scheduleRows}
        metricLabel={t('learned.cycle')}
        sourceText={t('source.ml_adjusted')}
        standardText={`${selectedLearned.stdBaseline}m`}
        learned={{
          learnedText: `${selectedLearned.learnedValue.toFixed(2)}m`,
          deltaText: `${selectedLearned.learnedValue >= selectedLearned.stdBaseline ? '+' : ''}${Math.round(((selectedLearned.learnedValue - selectedLearned.stdBaseline) / selectedLearned.stdBaseline) * 100)}%`,
          confidence: selectedLearned.confidence ?? 0,
          basisText: t('learned.basis', { count: selectedLearned.sampleCount }),
          settledText: t('learned.settled'),
          trigger:
            (selectedLearned.learnedValue - selectedLearned.stdBaseline) / selectedLearned.stdBaseline >= WEAR_PCT
              ? { title: t('wear.trigger'), body: t('wear.triggerBody', { resource: resourceName.get(selectedOp.resourceId) ?? '' }) }
              : undefined,
        }}
        performanceLabel={t('board.perf.title')}
        performanceRows={perfRows}
        performanceEmptyText={t('board.perf.empty')}
        prediction={predictionText}
      />
    ) : (
      <LearnedParamPanel
        title={`${partNo.get(selectedOp.partId) ?? selectedOp.partId} · ${resourceName.get(selectedOp.resourceId) ?? ''}`}
        subtitle={`op ${selectedOp.opSeq}`}
        status={selectedOp.atRisk ? { label: t('atRisk'), tone: 'danger' } : undefined}
        scheduleRows={scheduleRows}
        metricLabel={t('learned.cycleStd')}
        sourceText={t('source.standard')}
        standardText={`${selectedOp.cycleTime}m`}
        secondary={{ label: t('learned.setupRow'), value: `${selectedOp.setupTime}m` }}
        standardNote={
          selectedLearned && selectedLearned.sampleCount > 0
            ? t('learned.accruing', { count: selectedLearned.sampleCount })
            : t('learned.noAdjustment')
        }
        performanceLabel={t('board.perf.title')}
        performanceRows={perfRows}
        performanceEmptyText={t('board.perf.empty')}
        prediction={predictionText}
      />
    )
  ) : null

  return (
    <>
      <PageHeader
        title={t('board.title')}
        subtitle={t('board.subtitle')}
        actions={
          <XStack gap="$2">
            {selectedVersion?.status === 'draft' ? (
              <AppButton variant="primary" size="$3" loading={commit.isPending} onPress={() => versionId && commit.mutate(versionId)}>
                {t('board.commit')}
              </AppButton>
            ) : null}
            <AppButton
              variant={planStale ? 'primary' : 'ghost'}
              size="$3"
              icon={planStale ? TriangleAlert : undefined}
              loading={solve.isPending}
              onPress={onSolve}
            >
              {t('board.resolve')}
            </AppButton>
          </XStack>
        }
      />

      <ContextSelectors
        selectors={[
          { label: t('board.plant'), value: plantId, options: plantOptions, onChange: setPlant, width: 240 },
          { label: t('board.version'), value: versionId, options: versionOptions, onChange: setVersionId, width: 360 },
        ]}
      />

      {errorMsg ? (
        <P size={3} color="$danger">
          {errorMsg}
        </P>
      ) : null}

      {planStale ? (
        <XStack
          alignItems="center"
          gap="$2"
          backgroundColor="$warningSoft"
          borderColor="$warning"
          borderWidth={1}
          borderRadius="$4"
          paddingHorizontal="$3"
          paddingVertical="$2.5"
        >
          <TriangleAlert size={16} color="$warning" />
          <P size={4} color="$textPrimary">
            {t('board.stale.banner')}
          </P>
        </XStack>
      ) : null}

      {detail ? (
        <XStack gap="$3" alignItems="center" flexWrap="wrap">
          <StatusPill tone={detail.version.status === 'committed' ? 'active' : detail.version.status === 'draft' ? 'neutral' : 'inactive'}>
            {t(`status.${detail.version.status}`)}
          </StatusPill>
          <P size={4} color="$textSecondary">
            {t('board.run.status')}: {t(`runStatus.${detail.run.status}`)} · {t('board.run.ops')}: {detail.operations.length} ·{' '}
            {t('board.run.demand')}: {detail.run.inputDemandCount}
          </P>
        </XStack>
      ) : null}

      {variance && varianceChips.length > 0 ? <VarianceStrip chips={varianceChips} /> : null}

      {detail ? <GanttLegend /> : null}

      {versions.length === 0 ? (
        <P size={3} color="$textSecondary">
          {t('board.empty')}
        </P>
      ) : detail ? (
        <ScheduleGantt
          resources={ganttResources}
          bars={bars}
          horizonStartMs={new Date(detail.version.horizonStart).getTime()}
          horizonEndMs={new Date(detail.version.horizonEnd).getTime()}
          barDetail={(bar) => (
            <YStack gap="$2" minWidth={210}>
              <P size={3} weight="b" color="$textPrimary">
                {bar.label}
              </P>
              <DetailRow label={t('board.tooltip.resource')} value={resourceName.get(bar.resourceId) ?? '—'} />
              <DetailRow label={t('board.tooltip.demandLine')} value={bar.demandLineId ?? '—'} />
              <DetailRow label={t('board.tooltip.scheduled')} value={`${fmtTime(bar.startMs)} – ${fmtTime(bar.endMs)}`} />
              <DetailRow label={t('board.tooltip.setup')} value={`${Math.round(bar.setupMin)} min`} />
              <DetailRow label={t('board.tooltip.run')} value={`${Math.round(bar.runMin)} min`} />
              <DetailRow label={t('board.tooltip.source')} value={bar.sourceTag} />
              {bar.atRisk ? (
                <P size={4} weight="b" color="$danger">
                  {t('atRisk')}
                </P>
              ) : null}
            </YStack>
          )}
          onBarSelect={setSelectedBarId}
          selectedBarId={selectedBarId}
          emptyText={t('board.noResources')}
        />
      ) : null}

      {/* Click/tap detail — self-contained (identity + learned/std + performance).
          Web: a persistent panel below the board (doesn't occlude the Gantt).
          Native: a bottom sheet (BarDetailSheet) — no hover dependency anywhere. */}
      {selectedOp ? (
        <BarDetailSheet open onClose={() => setSelectedBarId(null)}>
          {detailPanel}
        </BarDetailSheet>
      ) : null}
    </>
  )
}

/** A label/value row in the bar-detail popover. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <XStack justifyContent="space-between" gap="$4">
      <P size={3} color="$textSecondary">
        {label}
      </P>
      <P size={3} weight="m" color="$textPrimary">
        {value}
      </P>
    </XStack>
  )
}

/** Time as HH:MM (UTC, matching the Gantt's axis). */
function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Gantt legend — swatches match the bar visuals exactly; source lives here, not in bars. */
function GanttLegend() {
  const { t } = useTranslation('scheduling')
  const Entry = ({ swatch, label }: { swatch: ReactNode; label: string }) => (
    <XStack alignItems="center" gap="$2">
      {swatch}
      <P size={5} color="$textSecondary">
        {label}
      </P>
    </XStack>
  )
  return (
    <XStack gap="$4" flexWrap="wrap" alignItems="center">
      <Entry swatch={<YStack width={22} height={12} borderRadius="$2" backgroundColor="$primary" />} label={t('legend.run')} />
      {/* setup = run colour + a black-0.28 overlay, same recipe as the bar's setup head */}
      <Entry
        swatch={
          <YStack width={22} height={12} borderRadius="$2" backgroundColor="$primary" overflow="hidden">
            <YStack flex={1} style={{ backgroundColor: 'rgba(0,0,0,0.28)' }} />
          </YStack>
        }
        label={t('legend.setup')}
      />
      <Entry swatch={<YStack width={4} height={16} borderRadius="$1" backgroundColor="$primaryLight" />} label={t('legend.changeover')} />
      <Entry
        swatch={<YStack width={22} height={12} borderRadius="$2" backgroundColor="$primary" borderWidth={2} borderColor="$danger" />}
        label={t('legend.atRisk')}
      />
      <P size={5} color="$textSecondary">
        {t('legend.sourceNote')}
      </P>
    </XStack>
  )
}

/** Web board screen — the board body inside the desktop `AdminShell` chrome. */
export function BoardScreen() {
  const { t } = useTranslation('scheduling')
  return (
    <AdminShell activeId="board" title={t('board.title')}>
      <BoardContent />
    </AdminShell>
  )
}
