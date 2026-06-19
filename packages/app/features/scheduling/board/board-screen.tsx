'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { TriangleAlert } from '@tamagui/lucide-icons'
import type { GanttBar, MeasuredDetail, ParamProvenance, VarianceChip, WearPrediction } from '@perduraflow/ui'
import type { ChangeSet, WhatIfResultDto } from '@perduraflow/contracts'
import {
  AppButton,
  BarDetailSheet,
  ContextSelectors,
  DateRangeNav,
  LearnedParamPanel,
  P,
  PageHeader,
  Panel,
  ResourceWearPanel,
  ScheduleGantt,
  SegmentedControl,
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
  useScheduleDemand,
  useScheduleResources,
  useScheduleVersion,
  useScheduleVersions,
  useSolveSchedule,
} from '../../../hooks/useScheduling'
import { useLearnedParameters, usePredictions, useVariance } from '../../../hooks/useLearning'
import { useWhatIf } from '../../../hooks/useWhatIf'
import { useToast } from '../../../hooks/useToast'
import { AdminShell } from '../../shell/admin-shell'
import { WhatIfOptionSet } from '../../whatif/whatif-option-set'

/** Cycle deviation (learned vs std) at/above which a tool-wear flag is shown (mirrors RULE.STEP_BAND). */
const WEAR_PCT = 0.05
/** Behind-plan fraction at/above which a calm lane chip appears (BOARD-SIGNALS item 2). */
const BEHIND_PCT = 0.05
const MS_PER_DAY = 86_400_000
const utcDay = (ms: number): number => Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
/** Monday (UTC) of the week containing `ms`. */
const weekStartMon = (ms: number): number => utcDay(ms) - ((new Date(ms).getUTCDay() + 6) % 7) * MS_PER_DAY

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
  const { data: demand = [] } = useScheduleDemand(plantId ?? undefined)
  const { data: detail } = useScheduleVersion(versionId ?? undefined)
  const { data: variance } = useVariance(versionId ?? undefined)
  const { data: learned = [] } = useLearnedParameters()
  const { data: predictions = [] } = usePredictions()
  const solve = useSolveSchedule()
  const commit = useCommitSchedule()
  const whatIf = useWhatIf()
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResultDto | null>(null)
  const [whatIfError, setWhatIfError] = useState<string | null>(null)
  // Which condition produced the visible option-set — lets that condition's CTA toggle
  // (See options ⇄ Close options) and collapse what it opened.
  const [whatIfTrigger, setWhatIfTrigger] = useState<string | null>(null)
  const [selectedBarId, setSelectedBarId] = useState<string | null>(null)
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
  // Shift-model work-area (C1): Day|Week horizon + the navigated date (UTC-midnight ms).
  const [horizonMode, setHorizonMode] = useState<'day' | 'week'>('day')
  const [viewDate, setViewDate] = useState<number>(() => Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY)
  const { showToast } = useToast()
  const wearShown = useRef<Set<string>>(new Set())

  // Open on the day the schedule lives on (the version's horizon start), not literal
  // "today" — so the board isn't empty when the seed's dates differ from the clock.
  // Re-anchors only when the committed/selected version changes (date nav never re-fetches).
  useEffect(() => {
    if (detail) setViewDate(Math.floor(new Date(detail.version.horizonStart).getTime() / MS_PER_DAY) * MS_PER_DAY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.version.id])

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

  // A what-if result is scoped to the plant it was generated for — clear it (and the
  // detail selection) when the plant changes so one plant's options never bleed into
  // another's. The backend already rejects a cross-plant change-set (CHANGE_SET_INVALID);
  // this keeps the UI honest to the same scope.
  useEffect(() => {
    setWhatIfResult(null)
    setWhatIfError(null)
    setWhatIfTrigger(null)
    setSelectedBarId(null)
    setSelectedResourceId(null)
  }, [plantId])

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

  // Conditions live in the DATA (not yet re-solved): a line down = an inactive
  // resource; a demand change = a demand line whose qty ≠ the committed plan's qty.
  // The board detects them, suppresses the down line's (now-stranded) bars, and offers
  // costed options to review + apply (the real Apply→draft→commit, below).
  const downResourceIds = useMemo(() => new Set(resources.filter((r) => r.status !== 'active').map((r) => r.id)), [resources])

  const bars: GanttBar[] = (detail?.operations ?? []).filter((o) => !downResourceIds.has(o.resourceId)).map((o) => {
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
  // Visible range for the Gantt: the selected day (day mode) or its Mon–Sun week (week
  // mode). The committed version holds the whole multi-day schedule; this just scopes
  // which slice renders (no re-fetch — date nav is pure client scoping).
  const rangeStart = horizonMode === 'week' ? weekStartMon(viewDate) : utcDay(viewDate)
  const rangeEnd = horizonMode === 'week' ? rangeStart + 7 * MS_PER_DAY : rangeStart + MS_PER_DAY
  const visibleBars = bars.filter((b) => b.startMs >= rangeStart && b.startMs < rangeEnd)
  // A day is closed (non-working weekday / holiday) per the same calendar the engine used.
  const ww = detail?.workingWindow
  const isDayClosed = (dayMs: number): boolean => {
    if (!ww) return false
    if (!ww.workingDays.includes(new Date(dayMs).getUTCDay())) return true
    return ww.holidays.includes(new Date(dayMs).toISOString().slice(0, 10))
  }

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
    behind: downResourceIds.has(r.id) ? undefined : behindByResource.get(r.id),
    predicted: downResourceIds.has(r.id) ? undefined : predByResource.get(r.id),
    down: downResourceIds.has(r.id),
  }))
  const resourceName = useMemo(() => new Map(resources.map((r) => [r.id, r.name])), [resources])

  // Detected conditions (selected plant vs its committed plan) → reviewable cards.
  const plannedQtyByLine = useMemo(
    () => new Map((detail?.operations ?? []).map((o) => [o.demandLineId, o.plannedQty])),
    [detail],
  )
  // Show a line-down condition only while the selected plan still strands work on the
  // down line; once rerouted (the applied draft has 0 ops there) it self-clears.
  const lineDownConditions = resources
    .filter((r) => downResourceIds.has(r.id))
    .map((r) => ({ resourceId: r.id, name: r.name, affected: (detail?.operations ?? []).filter((o) => o.resourceId === r.id).length }))
    .filter((c) => c.affected > 0)
  const demandConditions = demand
    .map((d) => ({ demandLineId: d.demandLineId, to: d.requiredQty, from: plannedQtyByLine.get(d.demandLineId) }))
    .filter((c) => c.from != null && c.from !== c.to)

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

  // What-if (D55) — evaluate a detected condition → costed option-set. Demand change,
  // line down, and the prediction "so what" all route to the same engine; nothing
  // commits until the planner applies an option (the real D26 guardrail). Failures
  // (e.g. the whole plant infeasible — every eligible line down) surface honestly
  // instead of vanishing.
  const runWhatIf = (changeSet: ChangeSet, triggerKey: string) => {
    if (!plantId) return
    // Close the bar-detail sheet (native: a bottom sheet) when options are requested
    // from within it — otherwise it stays open over the option-set. No-op when the
    // trigger is a condition card (nothing selected).
    setSelectedBarId(null)
    setSelectedResourceId(null)
    setWhatIfResult(null)
    setWhatIfError(null)
    setWhatIfTrigger(triggerKey)
    whatIf.mutate(
      { plantId, changeSet },
      { onSuccess: setWhatIfResult, onError: (e) => setWhatIfError(translateError(getApiErrorCode(e))) },
    )
  }
  /** Collapse the visible option-set (the "Close options" half of the CTA toggle). */
  const closeWhatIf = () => {
    setWhatIfResult(null)
    setWhatIfError(null)
    setWhatIfTrigger(null)
  }
  /** A condition's option-set is currently open → its CTA reads "Close options". */
  const whatIfOpenFor = (triggerKey: string) => whatIfTrigger === triggerKey && Boolean(whatIfResult)
  const runDemandWhatIf = (demandLineId: string, to: number) =>
    runWhatIf({ origin: { type: 'demand', ref: demandLineId }, changes: [{ kind: 'demand_qty', demandLineId, to }] }, `demand-${demandLineId}`)
  const runLineDownWhatIf = (resourceId: string) => {
    const now = new Date()
    const week = new Date(now.getTime() + 7 * 86_400_000)
    runWhatIf({ origin: { type: 'collision', ref: resourceId }, changes: [{ kind: 'resource_window', resourceId, downFrom: now.toISOString(), downTo: week.toISOString() }] }, `down-${resourceId}`)
  }
  const runWearWhatIf = (resourceId: string) =>
    runWhatIf({ origin: { type: 'prediction', ref: resourceId }, changes: [{ kind: 'wear_remediation', resourceId, action: 'service' }] }, `wear-${resourceId}`)

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

  const r2 = (n: number) => Number(n.toFixed(2)) // round to ≤2 decimals (drops trailing zeros)
  const fmtH = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${Math.round(min)}m`)

  // ===== Operation panel (click a bar) — OPERATION-LEVEL ONLY =====
  // Measured when this op adopted a learned cycle from actuals; else standard. No
  // line-level wear/forecast/confidence here (that's the resource surface, below).
  const opProvenance: ParamProvenance =
    selectedLearned?.source === 'ml_adjusted' && selectedLearned.sampleCount > 0 && selectedLearned.learnedValue != null
      ? 'measured'
      : 'standard'

  let opMeasured: MeasuredDetail | undefined
  if (opProvenance === 'measured' && selectedLearned && selectedLearned.learnedValue != null) {
    const std = selectedLearned.stdBaseline
    const lv = selectedLearned.learnedValue
    opMeasured = {
      standardText: `${r2(std)}m`,
      learnedText: `${r2(lv)}m`,
      deltaText: `${lv >= std ? '+' : ''}${Math.round(((lv - std) / std) * 100)}%`,
      basisText: t('learned.basis', { count: selectedLearned.sampleCount }),
      settledText: t('learned.settled'),
    }
  }

  // Performance — planned vs actual; shown WHENEVER the op has actuals (independent of any forecast).
  type PerfRow = { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }
  let perfRows: PerfRow[] | undefined
  if (selectedOp?.actual) {
    const a = selectedOp.actual
    const plannedRun = selectedOp.setupTime + selectedOp.cycleTime * selectedOp.plannedQty
    const actualRun = (new Date(a.actualEnd).getTime() - new Date(a.actualStart).getTime()) / 60_000
    const runDelta = plannedRun > 0 ? (actualRun - plannedRun) / plannedRun : 0
    perfRows = [
      { label: t('board.perf.cycle'), value: a.actualCycleTime != null ? `${r2(selectedOp.cycleTime)} → ${r2(a.actualCycleTime)} min` : '—', tone: a.actualCycleTime == null ? undefined : a.actualCycleTime > selectedOp.cycleTime ? 'warn' : 'ok' },
      { label: t('board.perf.run'), value: `${Math.round(plannedRun)} → ${Math.round(actualRun)} min (${runDelta >= 0 ? '+' : ''}${Math.round(runDelta * 100)}%)`, tone: runDelta > 0.02 ? 'warn' : runDelta < -0.02 ? 'ok' : undefined },
      { label: t('board.perf.output'), value: `${a.goodQty} / ${a.scrapQty}`, tone: a.scrapQty > 0 ? 'bad' : 'ok' },
    ]
  }

  // A pointer to the line surface when the op's resource has a live forecast (the
  // prediction itself lives on the resource panel, never the op panel).
  const opResourceHasPrediction = selectedOp ? predictions.some((p) => p.resourceId === selectedOp.resourceId) : false

  const opPanel = selectedOp ? (
    <LearnedParamPanel
      title={`${partNo.get(selectedOp.partId) ?? selectedOp.partId} · ${resourceName.get(selectedOp.resourceId) ?? ''}`}
      subtitle={`op ${selectedOp.opSeq}`}
      status={selectedOp.atRisk ? { label: t('atRisk'), tone: 'danger' } : undefined}
      scheduleRows={scheduleRows}
      metricLabel={opProvenance === 'measured' ? t('learned.cycle') : t('learned.cycleStd')}
      sourceText={opProvenance === 'measured' ? t('source.ml_adjusted') : t('source.standard')}
      provenance={opProvenance}
      standardText={`${r2(selectedOp.cycleTime)}m`}
      secondary={{ label: t('learned.setupRow'), value: `${selectedOp.setupTime}m` }}
      standardNote={selectedLearned && selectedLearned.sampleCount > 0 ? t('learned.accruing', { count: selectedLearned.sampleCount }) : t('learned.noAdjustment')}
      measured={opMeasured}
      performance={selectedOp.actual ? { label: t('board.perf.title'), rows: perfRows, emptyText: t('board.perf.empty') } : undefined}
      wearPointer={
        opResourceHasPrediction
          ? {
              label: t('board.pred.pointer', { resource: resourceName.get(selectedOp.resourceId) ?? '' }),
              onPress: () => {
                setSelectedResourceId(selectedOp.resourceId)
                setSelectedBarId(null)
              },
            }
          : undefined
      }
    />
  ) : null

  // ===== Resource / line wear surface (click a lane) — RESOURCE-LEVEL ONLY =====
  const resName = selectedResourceId ? (resourceName.get(selectedResourceId) ?? '') : ''
  // The line's most relevant cycle forecast (earliest crossing).
  const linePred = selectedResourceId
    ? predictions
        .filter((p) => p.resourceId === selectedResourceId && p.param === 'cycle' && p.crossingAt)
        .sort((a, b) => new Date(a.crossingAt!).getTime() - new Date(b.crossingAt!).getTime())[0]
    : undefined
  // A held/predicted cycle materially above std on the line → the D56 wear signal.
  const lineWear = selectedResourceId
    ? learned.find((l) => l.resourceId === selectedResourceId && l.param === 'cycle' && l.learnedValue != null && (l.learnedValue - l.stdBaseline) / l.stdBaseline >= WEAR_PCT)
    : undefined

  let wearPrediction: WearPrediction | undefined
  if (linePred) {
    const lpStd = learnedCycleByKey.get(`${linePred.resourceId}:${linePred.routingOperationId}`)?.stdBaseline ?? linePred.threshold
    const band = linePred.threshold - lpStd
    const span = band > 0 ? band * 2 : 1
    wearPrediction = {
      statement: linePred.crossingAt
        ? t('board.pred.horizon', { horizon: fmtH(linePred.horizonMinutes), time: fmtTime(new Date(linePred.crossingAt).getTime()) })
        : t('board.pred.horizonNone'),
      proximity: {
        valueFrac: (linePred.predictedValue - lpStd) / span,
        notchFrac: band / span,
        caption: t('board.pred.trackCaption', { pct: Math.round((band / lpStd) * 100) }),
      },
      confidence: linePred.confidence,
      confidenceLabel: t('board.pred.confidence'),
      basisText: t('board.pred.basis', { count: linePred.sampleCount }),
    }
  }

  const lineOpsN = selectedResourceId ? (detail?.operations ?? []).filter((o) => o.resourceId === selectedResourceId).length : 0
  const selectedDown = selectedResourceId ? downResourceIds.has(selectedResourceId) : false

  // Down line (click a downed lane) — a "line is down" surface, not the normal panel.
  const downPanel = selectedResourceId && selectedDown ? (
    <ResourceWearPanel
      title={resName}
      subtitle={t('board.down.subtitle')}
      status={{ label: t('board.down.pill'), tone: 'danger' }}
      warning={{ title: t('board.down.title'), body: t('board.down.body', { count: lineOpsN, resource: resName }) }}
      action={{ label: t('whatif:trigger.seeOptions'), onPress: () => runLineDownWhatIf(selectedResourceId!), loading: whatIf.isPending }}
      emptyText=""
    />
  ) : null

  const resourcePanel = selectedResourceId && !selectedDown ? (
    <ResourceWearPanel
      title={resName}
      subtitle={t('board.pred.lineSubtitle')}
      status={linePred || lineWear ? { label: t('board.pred.wearPill'), tone: 'warning' } : undefined}
      warning={linePred || lineWear ? { title: t('wear.trigger'), body: t('wear.triggerBody', { resource: resName }) } : undefined}
      prediction={wearPrediction}
      consequence={
        linePred || lineWear
          ? {
              maintenance: t('board.pred.maintenance'),
              downstream: lineOpsN > 0 ? t('board.pred.downstream', { count: lineOpsN, resource: resName }) : t('board.pred.downstreamNone'),
            }
          : undefined
      }
      action={
        linePred || lineWear
          ? { label: t('whatif:trigger.seeOptions'), onPress: () => runWearWhatIf(selectedResourceId!), loading: whatIf.isPending }
          : undefined
      }
      emptyText={t('board.pred.healthy')}
    />
  ) : null

  const detailPanel = opPanel ?? downPanel ?? resourcePanel
  const conditionCount = lineDownConditions.length + demandConditions.length

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

      {/* Cockpit · conditions (D55) — detected disruptions in the data → review costed
          options → apply (draft → commit, the human guardrail). */}
      {detail && (conditionCount > 0 || whatIfResult || whatIfError) ? (
        <Panel title={t('whatif:trigger.title')}>
          {conditionCount === 0 ? (
            <P size={4} color="$textSecondary">
              {t('whatif:subtitle')}
            </P>
          ) : (
            <YStack gap="$2">
              {lineDownConditions.map((c) => {
                const open = whatIfOpenFor(`down-${c.resourceId}`)
                return (
                  <ConditionCard
                    key={`down-${c.resourceId}`}
                    title={t('whatif:condition.lineDown', { resource: c.name })}
                    detail={t('whatif:condition.lineDownDetail', { count: c.affected })}
                    cta={open ? t('whatif:trigger.closeOptions') : t('whatif:trigger.seeOptions')}
                    loading={whatIf.isPending && whatIfTrigger === `down-${c.resourceId}`}
                    onPress={() => (open ? closeWhatIf() : runLineDownWhatIf(c.resourceId))}
                  />
                )
              })}
              {demandConditions.map((c) => {
                const open = whatIfOpenFor(`demand-${c.demandLineId}`)
                return (
                  <ConditionCard
                    key={`demand-${c.demandLineId}`}
                    title={t('whatif:condition.demand', { line: c.demandLineId })}
                    detail={t('whatif:condition.demandDetail', { from: c.from, to: c.to })}
                    cta={open ? t('whatif:trigger.closeOptions') : t('whatif:trigger.seeOptions')}
                    loading={whatIf.isPending && whatIfTrigger === `demand-${c.demandLineId}`}
                    onPress={() => (open ? closeWhatIf() : runDemandWhatIf(c.demandLineId, c.to))}
                  />
                )
              })}
            </YStack>
          )}
          {whatIfError ? (
            <XStack marginTop="$3" gap="$2" alignItems="center" backgroundColor="$dangerSoft" borderRadius="$4" paddingHorizontal="$3" paddingVertical="$2.5">
              <TriangleAlert size={15} color="$danger" />
              <P size={4} color="$danger">
                {whatIfError}
              </P>
            </XStack>
          ) : null}
          {whatIfResult ? (
            <YStack marginTop="$3">
              <WhatIfOptionSet
                result={whatIfResult}
                onApplied={(v) => {
                  // Select the new draft (now in the refreshed version list) and clear the
                  // option-set so it can't be re-applied.
                  setVersionId(v)
                  closeWhatIf()
                }}
              />
            </YStack>
          ) : null}
        </Panel>
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

      {/* Shift-model work-area (C1): Day|Week horizon toggle + date navigation. */}
      {detail ? (
        <XStack gap="$3" alignItems="center" justifyContent="space-between" flexWrap="wrap">
          <SegmentedControl<'day' | 'week'>
            options={[
              { value: 'day', label: t('board.horizon.day') },
              { value: 'week', label: t('board.horizon.week') },
            ]}
            value={horizonMode}
            onChange={setHorizonMode}
          />
          <DateRangeNav
            mode={horizonMode}
            valueMs={viewDate}
            onChange={setViewDate}
            isDayClosed={isDayClosed}
            labels={{ today: t('board.nav.today'), prev: t('board.nav.prev'), next: t('board.nav.next'), pickTitle: t('board.nav.pick') }}
          />
        </XStack>
      ) : null}

      {detail ? <GanttLegend /> : null}

      {versions.length === 0 ? (
        <P size={3} color="$textSecondary">
          {t('board.empty')}
        </P>
      ) : detail ? (
        <ScheduleGantt
          resources={ganttResources}
          bars={visibleBars}
          horizon={horizonMode}
          viewDateMs={viewDate}
          onDaySelect={(d) => {
            setViewDate(d)
            setHorizonMode('day')
          }}
          closedText={t('board.closedDay')}
          horizonStartMs={new Date(detail.version.horizonStart).getTime()}
          horizonEndMs={new Date(detail.version.horizonEnd).getTime()}
          workingWindow={detail.workingWindow}
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
          onBarSelect={(id) => {
            setSelectedBarId(id)
            setSelectedResourceId(null)
          }}
          selectedBarId={selectedBarId}
          onResourceSelect={(id) => {
            setSelectedResourceId(id)
            setSelectedBarId(null)
          }}
          selectedResourceId={selectedResourceId}
          emptyText={t('board.noResources')}
        />
      ) : null}

      {/* Click/tap detail — two surfaces (BAR-PANEL-FIX): the operation panel (a bar)
          or the resource wear surface (a lane). Web: a persistent panel below the
          board; native: a bottom sheet. */}
      {detailPanel ? (
        <BarDetailSheet
          open
          onClose={() => {
            setSelectedBarId(null)
            setSelectedResourceId(null)
          }}
        >
          {detailPanel}
        </BarDetailSheet>
      ) : null}
    </>
  )
}

/** A detected-condition card on the board (line down / demand change) → review options. */
function ConditionCard({ title, detail, cta, loading, onPress }: { title: string; detail: string; cta: string; loading?: boolean; onPress: () => void }) {
  return (
    <XStack
      gap="$3"
      alignItems="center"
      justifyContent="space-between"
      flexWrap="wrap"
      backgroundColor="$warningSoft"
      borderRadius="$4"
      paddingHorizontal="$3"
      paddingVertical="$2.5"
    >
      <YStack flex={1} minWidth={200} gap="$0.5">
        <P size={3} weight="m" color="$textPrimary">
          {title}
        </P>
        <P size={4} color="$textSecondary">
          {detail}
        </P>
      </YStack>
      <AppButton variant="ghost" size="$3" loading={loading} onPress={onPress}>
        {cta}
      </AppButton>
    </XStack>
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
