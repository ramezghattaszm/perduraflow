'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, TriangleAlert } from '@tamagui/lucide-icons'
import type {
  GanttBar,
  MeasuredDetail,
  ParamProvenance,
  PredictedDetail,
  VarianceChip,
  WearPrediction,
} from '@perduraflow/ui'
import type { ChangeSet, WhatIfResultDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppSelect,
  BarDetailSheet,
  DateRangeNav,
  H,
  KpiTile,
  KpiTileRow,
  LatenessChain,
  LearnedParamPanel,
  P,
  PageHeader,
  Panel,
  ResourceWearPanel,
  ScheduleGantt,
  SegmentedControl,
  VarianceStrip,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { latenessLines, latenessSummary } from '../../../utils/lateness'
import { usePlants } from '../../../hooks/useOrg'
import { usePlantSelection } from '../../../hooks/usePlantSelection'
import { useParts, useResourceDowntime } from '../../../hooks/useMasterData'
import {
  useCommitSchedule,
  useDiscardDraft,
  useMaterialConditions,
  useScheduleDemand,
  useScheduleResources,
  useScheduleVersion,
  useScheduleVersions,
  useSolveSchedule,
} from '../../../hooks/useScheduling'
import { useLearnedParameters, usePredictions, useVariance } from '../../../hooks/useLearning'
import { useWhatIf } from '../../../hooks/useWhatIf'
import { useToast } from '../../../hooks/useToast'
import { useSessionState } from '../../../hooks/useSessionState'
import { useSetScreenContext } from '../../../stores/screenContext.store'
import { AdminShell } from '../../shell/admin-shell'
import { WhatIfOptionSet } from '../../whatif/whatif-option-set'
import { WorkListTable } from '../work-list/work-list-screen'

/** Cycle deviation (learned vs std) at/above which a tool-wear flag is shown (mirrors RULE.STEP_BAND). */
const WEAR_PCT = 0.05
/** Behind-plan fraction at/above which a calm lane chip appears (BOARD-SIGNALS item 2). */
const BEHIND_PCT = 0.05
const MS_PER_DAY = 86_400_000
const utcDay = (ms: number): number => Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
/** Monday (UTC) of the week containing `ms`. */
const weekStartMon = (ms: number): number =>
  utcDay(ms) - ((new Date(ms).getUTCDay() + 6) % 7) * MS_PER_DAY

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
  const { data: downtime = [] } = useResourceDowntime(plantId ?? undefined)
  const { data: demand = [] } = useScheduleDemand(plantId ?? undefined)
  const { data: materialConditions = [] } = useMaterialConditions(
    plantId ?? undefined,
    versionId ?? undefined
  )
  const { data: detail } = useScheduleVersion(versionId ?? undefined)
  const { data: variance } = useVariance(versionId ?? undefined)
  const { data: learned = [] } = useLearnedParameters()
  const { data: predictions = [] } = usePredictions(plantId ?? undefined)
  const solve = useSolveSchedule()
  const commit = useCommitSchedule()
  const discard = useDiscardDraft()
  const whatIf = useWhatIf()
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResultDto | null>(null)
  const [whatIfError, setWhatIfError] = useState<string | null>(null)
  // Which condition produced the visible option-set — lets that condition's CTA toggle
  // (See options ⇄ Close options) and collapse what it opened.
  const [whatIfTrigger, setWhatIfTrigger] = useState<string | null>(null)
  const [selectedBarId, setSelectedBarId] = useState<string | null>(null)
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
  // Shift-model work-area (C1): Day|Week horizon + the navigated date (UTC-midnight ms).
  // Both default to today's view but are **session-tracked** (web: sessionStorage, so a
  // refresh returns to the last day/horizon you were on; native: in-memory only — no refresh).
  const [horizonMode, setHorizonMode] = useSessionState<'day' | 'week'>('board.horizonMode', 'day')
  const [viewDate, setViewDate] = useSessionState<number>('board.viewDate', utcDay(Date.now()))
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
      a.resourceId === b.resourceId
        ? a.sequencePosition - b.sequencePosition
        : a.resourceId < b.resourceId
          ? -1
          : 1
    )
    let prevRes: string | null = null
    let prevColour: string | null | undefined = null
    for (const o of ops) {
      const colour = partColour.get(o.partId)
      if (o.resourceId === prevRes && colour != null && prevColour != null && colour !== prevColour)
        ids.add(o.id)
      prevRes = o.resourceId
      prevColour = colour
    }
    return ids
  }, [detail, partColour])

  // Conditions live in the DATA (not yet re-solved): a line down = a per-resource
  // resource_downtime window IN EFFECT NOW (`from ≤ now < to`); a demand change = a demand
  // line whose qty ≠ the committed plan's qty. The board detects them, marks the lane DOWN +
  // draws the closure block, and offers costed options to review + apply (Apply→draft→commit).
  // ONE source: the same windows the engine subtracts from capacity and roots the chain at.
  const downResourceIds = useMemo(() => {
    const now = Date.now()
    return new Set(
      downtime
        .filter((d) => d.isActive && Date.parse(d.from) <= now && now < Date.parse(d.to))
        .map((d) => d.resourceId)
    )
  }, [downtime])

  // ALL committed bars render — injecting a window does NOT re-solve, so the down lane's existing
  // plan is intact. Only the op OVERLAPPING [from,to) is affected; it renders under the closure
  // block (a conflict to review), and moves only on a re-solve (apply reroute). Do NOT suppress the
  // whole lane (that was the old binary-`status=inactive` model, which stranded morning ops too).
  const bars: GanttBar[] = (detail?.operations ?? [])
    .map((o) => {
      const ml = o.cycleSource === 'ml_adjusted' || o.setupSource === 'ml_adjusted'
      const predicted = o.cycleSource === 'ml_predicted' || o.setupSource === 'ml_predicted'
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
        // STRANDED (server fact): committed op inside an active down-window — can't run as planned.
        // Distinct from atRisk; rendered as "can't run", not on-time. Same source as the work-list.
        stranded: o.stranded ?? false,
        changeover: changeoverIds.has(o.id),
        ml,
        predicted,
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

  // View-only when the whole visible range is in the past — the day(s) are over, so the
  // schedule is read-only: signals + lane/job detail still show, but Re-solve / what-if
  // options are disabled (no rolling-horizon machinery; the demo just bounds the past).
  const today = utcDay(Date.now())
  const readOnly = rangeEnd <= today
  // Date navigation clamps to the version horizon, buffered to whole weeks; prev/next
  // disable at the edges. (Today is exempt — it jumps to the real date even if outside.)
  const navMin = detail ? weekStartMon(new Date(detail.version.horizonStart).getTime()) : undefined
  const navMax = detail
    ? weekStartMon(new Date(detail.version.horizonEnd).getTime()) + 6 * MS_PER_DAY
    : undefined

  // Per-resource behind-plan chip (BOARD-SIGNALS item 2): the variance is about the
  // resource, so it lives on the lane. Threshold-gated + settled; reads the CONTINUOUS
  // per-resource attainment (executed-past, Reporting-Policy window) so it holds across a re-solve.
  const behindByResource = new Map(
    (variance?.resources ?? [])
      .filter((r) => r.behindPlanPct >= BEHIND_PCT)
      .map((r) => [
        r.resourceId,
        t('variance.behindPlan', { pct: Math.round(r.behindPlanPct * 100) }),
      ])
  )
  // Forward-looking lane flag (phase 4, FS18): a live predicted threshold-crossing on
  // the resource → a calm settled "predicted wear ~HH:MM" chip (when not already behind).
  const predByResource = new Map<string, string>()
  for (const p of predictions) {
    if (p.crossingAt && !predByResource.has(p.resourceId)) {
      predByResource.set(
        p.resourceId,
        t('board.predictedWear', { time: fmtTime(new Date(p.crossingAt).getTime()) })
      )
    }
  }
  // Per-lane utilization (D-util) — capacity over the forward window, one grounded source (variance)
  // feeding the lane badge AND the KPI strip. >100% = overloaded (red glance); <60% = slack (info).
  const utilByResource = new Map(
    (variance?.resources ?? []).map((r) => [r.resourceId, r.utilizationPct])
  )
  const utilTone = (p: number): 'ok' | 'bad' | 'info' => (p > 1 ? 'bad' : p < 0.6 ? 'info' : 'ok')
  // Lane sub-label: don't echo the raw resource_type enum ("Line"); show the calm utilization badge
  // (always — variance subtracts the closure, so a down lane's util is the real reduced-capacity
  // number) and the behind/predicted anomaly chips. The Gantt decides composition on a DOWN lane
  // (shows DOWN + util; drops the longer behind/predicted text to keep the 62px header uncluttered).
  const ganttResources = resources.map((r) => {
    const p = utilByResource.get(r.id)
    return {
      id: r.id,
      label: r.name,
      behind: behindByResource.get(r.id),
      predicted: predByResource.get(r.id),
      down: downResourceIds.has(r.id),
      util: p != null ? { label: `${Math.round(p * 100)}%`, tone: utilTone(p) } : undefined,
    }
  })
  const resourceName = useMemo(() => new Map(resources.map((r) => [r.id, r.name])), [resources])
  // Closures (line-down / maintenance) drawn on the lane track — every active window (in-effect or
  // future-in-horizon), so the outage TIMING is legible. Same source as DOWN + the engine's capacity cut.
  const ganttClosures = useMemo(
    () =>
      downtime
        .filter((d) => d.isActive)
        .map((d) => ({ resourceId: d.resourceId, startMs: Date.parse(d.from), endMs: Date.parse(d.to), label: t('board.down.pill') })),
    [downtime, t]
  )
  // Active downtime windows by resource (epoch-ms) — drives the GENUINELY-affected count (ops that
  // overlap the window, not the whole line) and the situation copy ({from}–{to}). Same source as DOWN.
  const windowsByResource = useMemo(() => {
    const m = new Map<string, Array<{ from: number; to: number }>>()
    for (const d of downtime) {
      if (!d.isActive) continue
      const arr = m.get(d.resourceId) ?? []
      arr.push({ from: Date.parse(d.from), to: Date.parse(d.to) })
      m.set(d.resourceId, arr)
    }
    return m
  }, [downtime])
  // The representative window on a resource for copy — the one in effect now, else the earliest.
  const repWindow = (resourceId: string): { from: number; to: number } | null => {
    const wins = windowsByResource.get(resourceId) ?? []
    if (wins.length === 0) return null
    const now = Date.now()
    return wins.find((w) => w.from <= now && now < w.to) ?? [...wins].sort((a, b) => a.from - b.from)[0]!
  }

  // KPI strip (D-util headline) — all computed from the committed schedule, no literals. On-time +
  // At-risk derive from the ops (+ demand firmness); Utilization + Throughput come from the SAME
  // variance payload as the lane badges, so the strip and lanes reconcile.
  const kpiOps = detail?.operations ?? []
  const onTimePct =
    kpiOps.length > 0 ? 1 - kpiOps.filter((o) => o.atRisk).length / kpiOps.length : 1
  const firmLineIds = useMemo(
    () => new Set(demand.filter((d) => d.firmness === 'firm').map((d) => d.demandLineId)),
    [demand]
  )
  const atRiskFirmCount = new Set(
    kpiOps.filter((o) => o.atRisk && firmLineIds.has(o.demandLineId)).map((o) => o.demandLineId)
  ).size
  // Stranded orders (committed op inside an active down-window) — a FACT, distinct from at-risk.
  // Counts to MATCH the work-list 'stranded' rollup (counts.stranded) so the two surfaces reconcile:
  // distinct ORDERS with a not-yet-run stranded op, EXCLUDING orders that are at-risk (at_risk outranks
  // stranded). ALL firmness — stranded is plan-infeasibility (a can't-run op is can't-run regardless),
  // unlike the firm-scoped at-risk delivery tile. (The earlier firm-only count under-read the work-list.)
  const atRiskOrderIds = new Set(kpiOps.filter((o) => o.atRisk).map((o) => o.demandLineId))
  const strandedCount = new Set(
    kpiOps
      .filter((o) => o.stranded && o.actual == null && !atRiskOrderIds.has(o.demandLineId))
      .map((o) => o.demandLineId)
  ).size
  const plantUtil = variance?.utilizationPct ?? null
  // The KPI strip is a plant-state surface → CONTINUOUS throughput (executed-past, Reporting-Policy
  // window), which holds across a re-solve. The per-version attainment is the scorecard's retrospective.
  const tputPct = variance?.plantThroughputAttainment ?? null

  // Detected conditions (selected plant vs its committed plan) → reviewable cards.
  const plannedQtyByLine = useMemo(
    () => new Map((detail?.operations ?? []).map((o) => [o.demandLineId, o.plannedQty])),
    [detail]
  )
  // A line-down condition surfaces only when committed ops actually OVERLAP the outage window
  // (the genuinely-conflicting ops that need re-sequencing) — NOT the whole line's workload, and
  // NOT a delivery verdict. `affected` is a planning fact; whether anything goes late is the
  // what-if's verdict (absorbed vs at-risk). Self-clears once a re-solve moves the work.
  const lineDownConditions = resources
    .filter((r) => downResourceIds.has(r.id))
    .map((r) => {
      const wins = windowsByResource.get(r.id) ?? []
      const win = repWindow(r.id)
      const affected = (detail?.operations ?? []).filter(
        (o) =>
          o.resourceId === r.id &&
          overlapsAnyWindow(new Date(o.plannedStart).getTime(), new Date(o.plannedEnd).getTime(), wins)
      ).length
      return { resourceId: r.id, name: r.name, affected, from: win?.from ?? null, to: win?.to ?? null }
    })
    .filter((c) => c.affected > 0)
  const demandConditions = demand
    .map((d) => ({
      demandLineId: d.demandLineId,
      to: d.requiredQty,
      from: plannedQtyByLine.get(d.demandLineId),
    }))
    .filter((c) => c.from != null && c.from !== c.to)

  // Learned cycle overlays keyed by (resource, op) — the LearnedParamPanel source.
  const learnedCycleByKey = useMemo(
    () =>
      new Map(
        learned
          .filter((l) => l.param === 'cycle')
          .map((l) => [`${l.resourceId}:${l.routingOperationId}`, l])
      ),
    [learned]
  )
  const opById = useMemo(() => new Map((detail?.operations ?? []).map((o) => [o.id, o])), [detail])

  // Variance strip chips — all computed; only meaningful chips show, so a clean
  // pre-drift version (no actuals, no churn, no learned values) shows NONE.
  const varianceChips: VarianceChip[] = useMemo(() => {
    if (!variance) return []
    const chips: VarianceChip[] = []
    // Only flag "behind plan" at the SAME threshold the lanes use (BEHIND_PCT) — below it, normal
    // yield (~4%) is healthy and the green throughput chip says so; a red "behind" callout next to a
    // green 96% chip is self-contradictory. Top strip and lanes now agree on what counts as behind.
    const behind = [...variance.resources].sort((a, b) => b.behindPlanPct - a.behindPlanPct)[0]
    if (behind && behind.behindPlanPct >= BEHIND_PCT) {
      chips.push({
        label: behind.resourceName,
        value: t('variance.behindPlan', { pct: Math.round(behind.behindPlanPct * 100) }),
        tone: 'bad',
      })
    }
    // Throughput attainment now lives only on the KPI strip (kpi.throughput) — kept out of this strip
    // so the figure isn't shown twice on the board.
    if (variance.churn != null && variance.churn > 0.005) {
      chips.push({
        label: t('variance.churn'),
        value:
          variance.churn < 0.34
            ? t('variance.churnLow')
            : variance.churn < 0.67
              ? t('variance.churnMed')
              : t('variance.churnHigh'),
        tone: variance.churn < 0.34 ? 'warn' : 'bad',
      })
    }
    if (variance.learnedParamCount > 0) {
      chips.push({
        label: t('variance.learnedParams'),
        value: t('variance.learnedCount', {
          count: variance.learnedParamCount,
          total: variance.opCount,
        }),
        tone: 'ok',
      })
    }
    return chips
  }, [variance, t])

  // D56 tool-wear flag → toast (once per resource/op when the wear actually CROSSES). Only fires on
  // `ml_adjusted` (learned from observed actuals = materialized); a `ml_predicted` pre-adjust acts on
  // the FORECAST and hasn't crossed, so it must NOT raise a "crossed / past threshold" toast.
  useEffect(() => {
    for (const l of learned) {
      if (
        l.param !== 'cycle' ||
        l.status !== 'held' ||
        l.learnedValue == null ||
        l.source !== 'ml_adjusted'
      )
        continue
      const dev = l.stdBaseline > 0 ? (l.learnedValue - l.stdBaseline) / l.stdBaseline : 0
      const key = `${l.resourceId}:${l.routingOperationId}`
      if (dev >= WEAR_PCT && !wearShown.current.has(key)) {
        wearShown.current.add(key)
        showToast(
          t('wear.body', {
            resource: resourceName.get(l.resourceId) ?? l.resourceId,
            pct: `+${Math.round(dev * 100)}`,
          }),
          {
            title: t('wear.title'),
            type: 'warning',
          }
        )
      }
    }
  }, [learned, resourceName, showToast, t])

  const selectedOp = selectedBarId ? opById.get(selectedBarId) : undefined
  const selectedLearned = selectedOp
    ? learnedCycleByKey.get(`${selectedOp.resourceId}:${selectedOp.routingOperationId}`)
    : undefined

  // Publish the board's live selection so the Copilot can resolve deictic references ("this
  // order", "this option") against what's on screen (Pass B). Cleared on unmount so a stale
  // board selection never leaks onto another screen. Read imperatively at send time, so the
  // turn always carries the current selection.
  const setScreenContext = useSetScreenContext()
  useEffect(() => {
    setScreenContext({
      screen: 'board',
      view: horizonMode,
      versionId: versionId ?? undefined,
      selectedOrderId: selectedOp?.demandLineId ?? undefined,
      selectedResourceId: selectedResourceId ?? undefined,
      activeResultId: whatIfResult?.id ?? undefined,
    })
    return () => setScreenContext(null)
  }, [
    setScreenContext,
    horizonMode,
    versionId,
    selectedOp?.demandLineId,
    selectedResourceId,
    whatIfResult?.id,
  ])

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
    if (!plantId || readOnly) return
    solve.mutate(plantId, { onSuccess: (v) => setVersionId(v.id) })
  }

  // What-if (D55) — evaluate a detected condition → costed option-set. Demand change,
  // line down, and the prediction "so what" all route to the same engine; nothing
  // commits until the planner applies an option (the real D26 guardrail). Failures
  // (e.g. the whole plant infeasible — every eligible line down) surface honestly
  // instead of vanishing.
  const runWhatIf = (changeSet: ChangeSet, triggerKey: string) => {
    if (!plantId || readOnly) return
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
      {
        onSuccess: setWhatIfResult,
        onError: (e) => setWhatIfError(translateError(getApiErrorCode(e))),
      }
    )
  }
  /** Collapse the visible option-set (the "Close options" half of the CTA toggle). */
  const closeWhatIf = () => {
    setWhatIfResult(null)
    setWhatIfError(null)
    setWhatIfTrigger(null)
  }
  /** A condition's option-set is currently open → its CTA reads "Close options". */
  const whatIfOpenFor = (triggerKey: string) =>
    whatIfTrigger === triggerKey && Boolean(whatIfResult)
  const runDemandWhatIf = (demandLineId: string, to: number) =>
    runWhatIf(
      {
        origin: { type: 'demand', ref: demandLineId },
        changes: [{ kind: 'demand_qty', demandLineId, to }],
      },
      `demand-${demandLineId}`
    )
  // Remediation-only: the line-down WINDOW already lives in the persisted base (resource_downtime),
  // so the what-if sends just the `line_down` marker (the response request) — the engine evaluates
  // reroute / overtime against the base that already reflects the outage. No resource_window in the
  // change-set → no double-apply; and the committed plan honors the window via base → no commit-gap.
  const runLineDownWhatIf = (resourceId: string) => {
    runWhatIf(
      {
        origin: { type: 'collision', ref: resourceId },
        changes: [{ kind: 'line_down', resourceId }],
      },
      `down-${resourceId}`
    )
  }
  const runWearWhatIf = (resourceId: string) =>
    runWhatIf(
      {
        origin: { type: 'prediction', ref: resourceId },
        changes: [{ kind: 'wear_remediation', resourceId, action: 'service' }],
      },
      `wear-${resourceId}`
    )
  const runMaterialWhatIf = (componentPartId: string, availableAt: string) =>
    runWhatIf(
      {
        origin: { type: 'collision', ref: componentPartId },
        changes: [{ kind: 'material_arrival', componentPartId, availableAt }],
      },
      `material-${componentPartId}`
    )

  // Self-contained bar detail (identity + learned/std + performance). Identity is
  // repeated so the panel/sheet stands alone (the tap target never assumes a hover).
  // The active down-window overlapping THIS op's slot — why it's stranded (for the bar-detail card).
  const selectedStrandedWindow =
    selectedOp && selectedOp.stranded
      ? (() => {
          const s = new Date(selectedOp.plannedStart).getTime()
          const e = new Date(selectedOp.plannedEnd).getTime()
          return (windowsByResource.get(selectedOp.resourceId) ?? []).find((w) => s < w.to && e > w.from) ?? null
        })()
      : null
  const selectedStrandedWindowLabel = selectedStrandedWindow
    ? (() => {
        const w = fmtWindow(selectedStrandedWindow.from, selectedStrandedWindow.to)
        return `${w.from} – ${w.to}`
      })()
    : null
  const scheduleRows = selectedOp
    ? [
        {
          label: t('board.tooltip.resource'),
          value: resourceName.get(selectedOp.resourceId) ?? '—',
        },
        { label: t('board.tooltip.demandLine'), value: selectedOp.demandLineId ?? '—' },
        {
          label: t('board.tooltip.scheduled'),
          value: `${fmtTime(new Date(selectedOp.plannedStart).getTime())} – ${fmtTime(new Date(selectedOp.plannedEnd).getTime())}`,
        },
        // Stranded: the line is down across this op's slot → it can't run as planned.
        ...(selectedStrandedWindowLabel
          ? [{ label: t('board.tooltip.downWindow'), value: selectedStrandedWindowLabel }]
          : []),
        { label: t('board.tooltip.setup'), value: `${Math.round(selectedOp.setupTime)} min` },
        {
          label: t('board.tooltip.run'),
          value: `${Math.round(selectedOp.cycleTime * selectedOp.plannedQty)} min`,
        },
      ]
    : []

  const r2 = (n: number) => Number(n.toFixed(2)) // round to ≤2 decimals (drops trailing zeros)
  const fmtH = (min: number) =>
    min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${Math.round(min)}m`

  // ===== Operation panel (click a bar) — OPERATION-LEVEL ONLY =====
  // Provenance reflects the cycle the SCHEDULE PLANNED THIS OP WITH — `selectedOp.cycleSource`,
  // which is per-op and date-aware (the forward-only gate already reverted past ops to std). We do
  // NOT read the line's live overlay row here: that single record is date-agnostic, so after a
  // pre-adopt it would mislabel an already-run op (cycleSource=standard, with actuals) as
  // "predicted". Actuals, when present, render in the Performance section below — independent of
  // provenance (an executed op shows its planned source + its actuals, never "predicted").
  const opSource = selectedOp?.cycleSource
  const opProvenance: ParamProvenance =
    opSource === 'ml_predicted' ? 'predicted' : opSource === 'ml_adjusted' ? 'measured' : 'standard'

  let opMeasured: MeasuredDetail | undefined
  if (opProvenance === 'measured' && selectedLearned?.source === 'ml_adjusted' && selectedLearned.learnedValue != null) {
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

  // Adopted-but-not-applied: a held learned value EXISTS for this op, yet the committed plan still
  // runs it on standard (the plan is stale until re-solve). This is NOT "still accruing / not enough
  // to adopt" — adoption already happened; the schedule just hasn't picked it up. Keep the two
  // honestly distinct so the op panel never claims "not enough actuals" when the learner has adopted.
  const opAdoptedStale =
    opProvenance === 'standard' && selectedLearned?.status === 'held' && selectedLearned.learnedValue != null
  const opLearnedDeltaPct =
    selectedLearned && selectedLearned.learnedValue != null && selectedLearned.stdBaseline > 0
      ? Math.round(((selectedLearned.learnedValue - selectedLearned.stdBaseline) / selectedLearned.stdBaseline) * 100)
      : 0

  let opPredicted: PredictedDetail | undefined
  if (opProvenance === 'predicted' && selectedLearned?.source === 'ml_predicted' && selectedLearned.learnedValue != null) {
    const std = selectedLearned.stdBaseline
    const pv = selectedLearned.learnedValue
    opPredicted = {
      standardText: `${r2(std)}m`,
      predictedText: `${r2(pv)}m`,
      deltaText: `${pv >= std ? '+' : ''}${Math.round(((pv - std) / std) * 100)}%`,
      basisText: t('learned.predictedBasis'),
      noteText: t('learned.predictedNote'),
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
      {
        label: t('board.perf.cycle'),
        value:
          a.actualCycleTime != null
            ? `${r2(selectedOp.cycleTime)} → ${r2(a.actualCycleTime)} min`
            : '—',
        tone:
          a.actualCycleTime == null
            ? undefined
            : a.actualCycleTime > selectedOp.cycleTime
              ? 'warn'
              : 'ok',
      },
      {
        label: t('board.perf.run'),
        value: `${Math.round(plannedRun)} → ${Math.round(actualRun)} min (${runDelta >= 0 ? '+' : ''}${Math.round(runDelta * 100)}%)`,
        tone: runDelta > 0.02 ? 'warn' : runDelta < -0.02 ? 'ok' : undefined,
      },
      {
        label: t('board.perf.output'),
        value: `${a.goodQty} / ${a.scrapQty}`,
        tone: a.scrapQty > 0 ? 'bad' : 'ok',
      },
    ]
  }

  // A pointer to the line surface when the op's resource has a live forecast (the
  // prediction itself lives on the resource panel, never the op panel).
  const opResourceHasPrediction = selectedOp
    ? predictions.some((p) => p.resourceId === selectedOp.resourceId)
    : false

  const tl = (k: string, o?: Record<string, unknown>): string => t(k, o ?? {})
  const opPanel = selectedOp ? (
    <YStack gap="$2.5">
      <LearnedParamPanel
        title={`${partNo.get(selectedOp.partId) ?? selectedOp.partId} · ${resourceName.get(selectedOp.resourceId) ?? ''}`}
        subtitle={`op ${selectedOp.opSeq}`}
        status={
          selectedOp.atRisk
            ? {
                label: selectedOp.atRiskReason
                  ? t('atRiskWithReason', {
                      reason: t(`riskReason.${selectedOp.atRiskReason}`, {
                        defaultValue: selectedOp.atRiskReason,
                      }),
                    })
                  : t('atRisk'),
                tone: 'danger',
              }
            : selectedOp.stranded
              ? // FACT, not a prediction: the line is down across this op's slot — it can't run as
                // planned (re-sequence). Amber (warning), distinct from at-risk red. See the down-window
                // row + the line-down condition card's options.
                { label: t('strandedStatus'), tone: 'warning' as const }
              : undefined
        }
        scheduleRows={scheduleRows}
        metricLabel={
          opProvenance === 'measured'
            ? t('learned.cycle')
            : opProvenance === 'predicted'
              ? t('learned.cyclePredicted')
              : t('learned.cycleStd')
        }
        sourceText={
          opProvenance === 'measured'
            ? t('source.ml_adjusted')
            : opProvenance === 'predicted'
              ? t('source.ml_predicted')
              : t('source.standard')
        }
        provenance={opProvenance}
        standardText={`${r2(selectedOp.cycleTime)}m`}
        secondary={{ label: t('learned.setupRow'), value: `${selectedOp.setupTime}m` }}
        standardNote={
          opAdoptedStale
            ? t('learned.staleAdopted', {
                delta: opLearnedDeltaPct,
                count: selectedLearned?.sampleCount ?? 0,
              })
            : selectedLearned && selectedLearned.sampleCount > 0
              ? t('learned.accruing', { count: selectedLearned.sampleCount })
              : t('learned.noAdjustment')
        }
        measured={opMeasured}
        predicted={opPredicted}
        performance={
          selectedOp.actual
            ? { label: t('board.perf.title'), rows: perfRows, emptyText: t('board.perf.empty') }
            : undefined
        }
        wearPointer={
          opResourceHasPrediction
            ? {
                label: t('board.pred.pointer', {
                  resource: resourceName.get(selectedOp.resourceId) ?? '',
                }),
                onPress: () => {
                  setSelectedResourceId(selectedOp.resourceId)
                  setSelectedBarId(null)
                },
              }
            : undefined
        }
      />
      {selectedOp.latenessChain ? (
        <LatenessChain
          title={t('lateness.why')}
          summary={latenessSummary(selectedOp.latenessChain, tl)}
          lines={latenessLines(selectedOp.latenessChain, tl)}
          expandLabel={t('lateness.expand')}
          collapseLabel={t('lateness.collapse')}
        />
      ) : null}
    </YStack>
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
    ? learned.find(
        (l) =>
          l.resourceId === selectedResourceId &&
          l.param === 'cycle' &&
          l.learnedValue != null &&
          (l.learnedValue - l.stdBaseline) / l.stdBaseline >= WEAR_PCT
      )
    : undefined

  let wearPrediction: WearPrediction | undefined
  if (linePred) {
    const lpStd =
      learnedCycleByKey.get(`${linePred.resourceId}:${linePred.routingOperationId}`)?.stdBaseline ??
      linePred.threshold
    const band = linePred.threshold - lpStd
    const span = band > 0 ? band * 2 : 1
    wearPrediction = {
      statement: linePred.crossingAt
        ? t('board.pred.horizon', {
            horizon: fmtH(linePred.horizonMinutes),
            time: fmtTime(new Date(linePred.crossingAt).getTime()),
          })
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

  // The down banner counts only ops OVERLAPPING the outage window (the genuinely-conflicting ones),
  // and states the situation — the at-risk/absorbed verdict comes from the what-if, not here.
  const selectedWindows = selectedResourceId ? (windowsByResource.get(selectedResourceId) ?? []) : []
  const selectedWindow = selectedResourceId ? repWindow(selectedResourceId) : null
  const lineOpsN = selectedResourceId
    ? (detail?.operations ?? []).filter(
        (o) =>
          o.resourceId === selectedResourceId &&
          overlapsAnyWindow(new Date(o.plannedStart).getTime(), new Date(o.plannedEnd).getTime(), selectedWindows)
      ).length
    : 0
  const selectedDown = selectedResourceId ? downResourceIds.has(selectedResourceId) : false

  // Down line (click a downed lane) — a "line is down" surface, not the normal panel.
  const downPanel =
    selectedResourceId && selectedDown ? (
      <ResourceWearPanel
        title={resName}
        subtitle={t('board.down.subtitle')}
        status={{ label: t('board.down.pill'), tone: 'danger' }}
        warning={{
          title: t('board.down.title'),
          body: t('board.down.body', {
            count: lineOpsN,
            resource: resName,
            ...(selectedWindow ? fmtWindow(selectedWindow.from, selectedWindow.to) : { from: '—', to: '—' }),
          }),
        }}
        action={
          readOnly
            ? undefined
            : {
                label: t('whatif:trigger.seeOptions'),
                onPress: () => runLineDownWhatIf(selectedResourceId!),
                loading: whatIf.isPending,
              }
        }
        emptyText=""
      />
    ) : null

  // Three wear states, keyed on the overlay SOURCE (an adopted value alone doesn't mean "crossed"):
  //  (1) forecast-not-acted — a prediction, no held overlay → approaching/advisory.
  //  (2) PRE-ADJUSTED — overlay source `ml_predicted` (approved / auto-committed off the FORECAST):
  //      acted AHEAD of the crossing; NOT crossed — "pre-emptively adjusted, not yet crossed".
  //  (3) CROSSED — overlay source `ml_adjusted` (learned from OBSERVED actuals): the drift materialised.
  const wearCrossed = lineWear?.source === 'ml_adjusted'
  const wearPreAdjusted = !!lineWear && !wearCrossed
  const wearSignal = linePred || lineWear
  // Is the adopted/pre-adopted overlay actually re-solved INTO this plan, or is the committed plan
  // still STALE (a held value exists but the ops here run standard)? "Re-sequenced / kept fed" may
  // only be claimed once applied — before a re-solve the protection is PENDING, not done. Keyed on
  // whether this line's ops carry the overlay's source (mirrors the plan-stale banner, per resource).
  const wearApplied =
    !!lineWear &&
    (detail?.operations ?? []).some(
      (o) => o.resourceId === selectedResourceId && o.cycleSource === lineWear.source
    )
  const resourcePanel =
    selectedResourceId && !selectedDown ? (
      <ResourceWearPanel
        title={resName}
        subtitle={t('board.pred.lineSubtitle')}
        status={
          wearSignal
            ? {
                label: t(
                  wearCrossed
                    ? 'board.pred.wearPill'
                    : wearPreAdjusted
                      ? 'board.pred.preAdjustPill'
                      : 'board.pred.forecastPill'
                ),
                tone: 'warning',
              }
            : undefined
        }
        warning={
          wearSignal
            ? {
                title: t(
                  wearCrossed
                    ? 'wear.trigger'
                    : wearPreAdjusted
                      ? 'wear.preadjust'
                      : 'wear.forecast'
                ),
                body: t(
                  wearCrossed
                    ? wearApplied
                      ? 'wear.triggerBody'
                      : 'wear.triggerBodyStale'
                    : wearPreAdjusted
                      ? wearApplied
                        ? 'wear.preadjustBody'
                        : 'wear.preadjustBodyStale'
                      : 'wear.forecastBody',
                  { resource: resName }
                ),
              }
            : undefined
        }
        prediction={wearPrediction}
        consequence={
          wearSignal
            ? {
                maintenance: t('board.pred.maintenance'),
                downstream:
                  lineOpsN > 0
                    ? t(
                        wearApplied
                          ? 'board.pred.downstream' // applied → genuinely kept fed by the adjustment
                          : lineWear
                            ? 'board.pred.downstreamStale' // adopted but plan stale → protected once re-solved
                            : 'board.pred.downstreamForecast', // pure forecast, no overlay → advisory
                        {
                          count: lineOpsN,
                          resource: resName,
                        }
                      )
                    : t('board.pred.downstreamNone'),
              }
            : undefined
        }
        action={
          wearSignal && !readOnly
            ? {
                label: t('whatif:trigger.seeOptions'),
                onPress: () => runWearWhatIf(selectedResourceId!),
                loading: whatIf.isPending,
              }
            : undefined
        }
        emptyText={t('board.pred.healthy')}
      />
    ) : null

  const detailPanel = opPanel ?? downPanel ?? resourcePanel
  const conditionCount =
    lineDownConditions.length + demandConditions.length + materialConditions.length

  // The line-down VERDICT (three reference points, after the determinism-cache fix that makes the
  // what-if base reflect the outage):
  //   R1 pre-outage  = the committed plan's at-risk orders (before the window).
  //   R2 with-outage = the what-if BASE (default re-route, no remediation) — now reflects the window.
  //   R3 remediation = the options (reroute = R2, overtime, …).
  // ABSORBED ⟺ the outage added no new lateness: R2.lateOrders ≤ R1. Otherwise AT-RISK — the option
  // set (reroute vs OT + cost) stands as decide-support. NOT R2-vs-options (R2 IS the outage, so
  // comparing remediations to it always reads "absorbed" — the b42d591 bug this replaces).
  const committedLateOrders = new Set(
    (detail?.operations ?? []).filter((o) => o.atRisk).map((o) => o.demandLineId)
  ).size
  const lineDownAbsorbed = Boolean(
    whatIfResult &&
      whatIfResult.changeSet.changes.some((c) => c.kind === 'line_down') &&
      whatIfResult.baseKpis.lateOrders <= committedLateOrders
  )

  return (
    <>
      <PageHeader
        title={t('board.title')}
        subtitle={t('board.subtitle')}
        actions={
          <XStack
            gap="$2"
            alignItems="center"
            flexWrap="wrap"
          >
            {/* Plant = the master scope for the whole cockpit → lives in the header toolbar. */}
            <YStack width={220}>
              <AppSelect
                options={plantOptions}
                value={plantId}
                onChange={setPlant}
                placeholder={t('board.plant')}
              />
            </YStack>
            {selectedVersion?.status === 'draft' ? (
              <>
                <AppButton
                  variant="primary"
                  size="$3"
                  loading={commit.isPending}
                  onPress={() => versionId && commit.mutate(versionId)}
                >
                  {t('board.commit')}
                </AppButton>
                {/* Discard is draft-only (the API enforces it too); selection self-repairs to the
                    committed/newest version after the discarded draft drops out of the list. */}
                <AppButton
                  variant="ghost"
                  size="$3"
                  loading={discard.isPending}
                  onPress={() => versionId && discard.mutate(versionId)}
                >
                  {t('board.discard')}
                </AppButton>
              </>
            ) : null}
            {/* Re-solve is disabled in view-only (past) mode — the day is over (UI-§5:
                simulate disabled with opacity + pointerEvents, not a Button `disabled`). */}
            <YStack
              opacity={readOnly ? 0.4 : 1}
              pointerEvents={readOnly ? 'none' : 'auto'}
            >
              <AppButton
                variant={planStale && !readOnly ? 'primary' : 'ghost'}
                size="$3"
                icon={planStale && !readOnly ? TriangleAlert : undefined}
                loading={solve.isPending}
                onPress={onSolve}
              >
                {t('board.resolve')}
              </AppButton>
            </YStack>
          </XStack>
        }
      />

      {detail ? (
        <KpiTileRow>
          <KpiTile
            label={t('kpi.onTime')}
            value={`${Math.round(onTimePct * 100)}%`}
            caption={t('kpi.onTimeCaption')}
            valueTone={onTimePct >= 0.95 ? 'ok' : onTimePct >= 0.85 ? 'warn' : 'bad'}
          />
          <KpiTile
            label={t('kpi.utilization')}
            value={plantUtil == null ? '—' : `${Math.round(plantUtil * 100)}%`}
            caption={t('kpi.utilizationCaption')}
            valueTone={
              plantUtil == null
                ? 'neutral'
                : plantUtil > 1
                  ? 'bad'
                  : plantUtil < 0.6
                    ? 'info'
                    : 'ok'
            }
          />
          <KpiTile
            label={t('kpi.atRisk')}
            value={String(atRiskFirmCount)}
            caption={t('kpi.atRiskCaption')}
            valueTone={atRiskFirmCount > 0 ? 'bad' : 'ok'}
          />
          {strandedCount > 0 ? (
            <KpiTile
              label={t('kpi.stranded')}
              value={String(strandedCount)}
              caption={t('kpi.strandedCaption')}
              valueTone="warn"
            />
          ) : null}
          <KpiTile
            label={t('kpi.throughput')}
            value={tputPct == null ? '—' : `${Math.round(tputPct * 100)}%`}
            caption={t('kpi.throughputCaption')}
            valueTone={tputPct == null ? 'neutral' : tputPct >= 0.95 ? 'ok' : 'warn'}
          />
        </KpiTileRow>
      ) : null}

      {errorMsg ? (
        <P
          size={3}
          color="$danger"
        >
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
          <TriangleAlert
            size={16}
            color="$warning"
          />
          <P
            size={4}
            color="$textPrimary"
          >
            {t('board.stale.banner')}
          </P>
        </XStack>
      ) : null}

      {/* Cockpit · conditions (D55) — detected disruptions in the data → review costed
          options → apply (draft → commit, the human guardrail). */}
      {detail && (conditionCount > 0 || whatIfResult || whatIfError) ? (
        <Panel title={t('whatif:trigger.title')}>
          {conditionCount === 0 ? (
            <P
              size={4}
              color="$textSecondary"
            >
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
                    detail={t('whatif:condition.lineDownDetail', {
                      count: c.affected,
                      ...(c.from != null && c.to != null ? fmtWindow(c.from, c.to) : { from: '—', to: '—' }),
                    })}
                    cta={open ? t('whatif:trigger.closeOptions') : t('whatif:trigger.seeOptions')}
                    loading={whatIf.isPending && whatIfTrigger === `down-${c.resourceId}`}
                    disabled={readOnly}
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
                    disabled={readOnly}
                    onPress={() => (open ? closeWhatIf() : runDemandWhatIf(c.demandLineId, c.to))}
                  />
                )
              })}
              {materialConditions.map((c) => {
                const open = whatIfOpenFor(`material-${c.componentPartId}`)
                return (
                  <ConditionCard
                    key={`material-${c.componentPartId}`}
                    title={t('whatif:condition.material', {
                      component: c.componentPartNo,
                      time: new Date(c.availableAt).toISOString().slice(11, 16),
                    })}
                    detail={t('whatif:condition.materialDetail', {
                      count: c.gatedDemandLineIds.length,
                    })}
                    cta={open ? t('whatif:trigger.closeOptions') : t('whatif:trigger.seeOptions')}
                    loading={whatIf.isPending && whatIfTrigger === `material-${c.componentPartId}`}
                    disabled={readOnly}
                    onPress={() =>
                      open ? closeWhatIf() : runMaterialWhatIf(c.componentPartId, c.availableAt)
                    }
                  />
                )
              })}
            </YStack>
          )}
          {whatIfError ? (
            <XStack
              marginTop="$3"
              gap="$2"
              alignItems="center"
              backgroundColor="$dangerSoft"
              borderRadius="$4"
              paddingHorizontal="$3"
              paddingVertical="$2.5"
            >
              <TriangleAlert
                size={15}
                color="$danger"
              />
              <P
                size={4}
                color="$danger"
              >
                {whatIfError}
              </P>
            </XStack>
          ) : null}
          {whatIfResult ? (
            <YStack marginTop="$3" gap="$3">
              {lineDownAbsorbed ? (
                <XStack
                  gap="$2"
                  alignItems="center"
                  backgroundColor="$successSoft"
                  borderRadius="$4"
                  paddingHorizontal="$3"
                  paddingVertical="$2.5"
                >
                  <CircleCheck size={15} color="$success" />
                  <P size={4} color="$success">
                    {t('whatif:condition.lineDownAbsorbed')}
                  </P>
                </XStack>
              ) : null}
              <WhatIfOptionSet
                result={whatIfResult}
                previewOnly={readOnly}
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

      {variance && varianceChips.length > 0 ? <VarianceStrip chips={varianceChips} /> : null}

      {/* Shift-model work-area (C1): Day|Week horizon toggle + date navigation. */}
      {detail ? (
        <XStack
          gap="$3"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          marginBottom="$-4"
        >
          {/* Version + its run summary (which plan you're viewing) → sits with the Gantt's own controls.
              The dropdown label already carries the status, so no separate status pill/row is needed. */}
          <XStack
            gap="$3"
            alignItems="center"
            flexWrap="wrap"
          >
            <YStack width={320}>
              <AppSelect
                options={versionOptions}
                value={versionId}
                onChange={setVersionId}
                placeholder={t('board.version')}
              />
            </YStack>
            <P
              size={4}
              color="$textSecondary"
            >
              {t('board.run.status')}: {t(`runStatus.${detail.run.status}`)} · {t('board.run.ops')}:{' '}
              {detail.operations.length} · {t('board.run.demand')}: {detail.run.inputDemandCount}
            </P>
          </XStack>
          {/* Horizon toggle + date navigation, grouped together on the right. */}
          <XStack
            gap="$3"
            alignItems="center"
            flexWrap="wrap"
          >
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
              minMs={navMin}
              maxMs={navMax}
              labels={{
                today: t('board.nav.today'),
                prev: t('board.nav.prev'),
                next: t('board.nav.next'),
                pickTitle: t('board.nav.pick'),
              }}
            />
          </XStack>
        </XStack>
      ) : null}

      {versions.length === 0 ? (
        <P
          size={3}
          color="$textSecondary"
        >
          {t('board.empty')}
        </P>
      ) : detail ? (
        <ScheduleGantt
          resources={ganttResources}
          bars={visibleBars}
          closures={ganttClosures}
          horizon={horizonMode}
          viewDateMs={viewDate}
          onDaySelect={(d) => {
            setViewDate(d)
            setHorizonMode('day')
          }}
          closedText={t('board.closedDay')}
          noWorkText={t('board.noWorkDay')}
          horizonStartMs={new Date(detail.version.horizonStart).getTime()}
          horizonEndMs={new Date(detail.version.horizonEnd).getTime()}
          workingWindow={detail.workingWindow}
          barDetail={(bar) => (
            <YStack
              gap="$2"
              minWidth={210}
            >
              <P
                size={3}
                weight="b"
                color="$textPrimary"
              >
                {bar.label}
              </P>
              <DetailRow
                label={t('board.tooltip.resource')}
                value={resourceName.get(bar.resourceId) ?? '—'}
              />
              <DetailRow
                label={t('board.tooltip.demandLine')}
                value={bar.demandLineId ?? '—'}
              />
              <DetailRow
                label={t('board.tooltip.scheduled')}
                value={`${fmtTime(bar.startMs)} – ${fmtTime(bar.endMs)}`}
              />
              <DetailRow
                label={t('board.tooltip.setup')}
                value={`${Math.round(bar.setupMin)} min`}
              />
              <DetailRow
                label={t('board.tooltip.run')}
                value={`${Math.round(bar.runMin)} min`}
              />
              <DetailRow
                label={t('board.tooltip.source')}
                value={bar.sourceTag}
              />
              {bar.atRisk ? (
                <P
                  size={4}
                  weight="b"
                  color="$danger"
                >
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

      {detail ? <GanttLegend /> : null}

      {/* Click/tap detail — two surfaces (BAR-PANEL-FIX): the operation panel (a bar)
          or the resource wear surface (a lane). Web: a persistent panel below the
          board; native: a bottom sheet. Kept directly under the Gantt (above the work
          list) so a selected bar's panel opens next to what was clicked. */}
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

      {/* Work list (D-worklist) below the Gantt — the all-work table for the selected plan, the same
          single source the standalone Work List screen + the exception queue read. Rendered flat
          (no card chrome) directly on the page, with extra space above to separate it from the Gantt. */}
      {detail ? (
        <YStack
          gap="$3"
          marginTop="$5"
        >
          <H
            level={3}
            color="$textPrimary"
          >
            {t('workList:title')}
          </H>
          <WorkListTable
            plantId={plantId ?? undefined}
            versionId={versionId ?? undefined}
          />
        </YStack>
      ) : null}
    </>
  )
}

/** A detected-condition card on the board (line down / demand change) → review options. */
function ConditionCard({
  title,
  detail,
  cta,
  loading,
  disabled,
  onPress,
}: {
  title: string
  detail: string
  cta: string
  loading?: boolean
  disabled?: boolean
  onPress: () => void
}) {
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
      <YStack
        flex={1}
        minWidth={200}
        gap="$0.5"
      >
        <P
          size={3}
          weight="m"
          color="$textPrimary"
        >
          {title}
        </P>
        <P
          size={4}
          color="$textSecondary"
        >
          {detail}
        </P>
      </YStack>
      {/* View-only (past day): the signal stays visible but the action is disabled
          (UI-§5: simulate disabled with opacity + pointerEvents, not Button `disabled`). */}
      {disabled ? null : (
        <AppButton
          variant="ghost"
          size="$3"
          loading={loading}
          onPress={onPress}
        >
          {cta}
        </AppButton>
      )}
    </XStack>
  )
}

/** A label/value row in the bar-detail popover. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <XStack
      justifyContent="space-between"
      gap="$4"
    >
      <P
        size={3}
        color="$textSecondary"
      >
        {label}
      </P>
      <P
        size={3}
        weight="m"
        color="$textPrimary"
      >
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
/** `Mon DD HH:MM` (UTC) — e.g. "Jun 25 19:48"; for windows that span days, where HH:MM alone is ambiguous.
 *  `timeZone: 'UTC'` keeps the date aligned with the UTC time {@link fmtTime} renders (matches `timeAgo`). */
function fmtDateTime(ms: number): string {
  const date = new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  return `${date} ${fmtTime(ms)}`
}
/**
 * Window endpoints for display: bare `HH:MM` when both fall on the same UTC day, else dated
 * (`Mon DD HH:MM`) — so a multi-day outage (e.g. a 48h window, both ends at 19:48) reads
 * "Jun 25 19:48 – Jun 27 19:48", not "19:48–19:48".
 */
function fmtWindow(fromMs: number, toMs: number): { from: string; to: string } {
  const DAY = 86_400_000
  const sameDay = Math.floor(fromMs / DAY) === Math.floor(toMs / DAY)
  return sameDay
    ? { from: fmtTime(fromMs), to: fmtTime(toMs) }
    : { from: fmtDateTime(fromMs), to: fmtDateTime(toMs) }
}

/** True if `[startMs, endMs)` overlaps any of the windows (half-open). */
function overlapsAnyWindow(startMs: number, endMs: number, windows: Array<{ from: number; to: number }>): boolean {
  return windows.some((w) => startMs < w.to && endMs > w.from)
}

/** Gantt legend — swatches match the bar visuals exactly; source lives here, not in bars. */
function GanttLegend() {
  const { t } = useTranslation('scheduling')
  const Entry = ({ swatch, label }: { swatch: ReactNode; label: string }) => (
    <XStack
      alignItems="center"
      gap="$2"
    >
      {swatch}
      <P
        size={5}
        color="$textSecondary"
      >
        {label}
      </P>
    </XStack>
  )
  return (
    <XStack
      gap="$4"
      flexWrap="wrap"
      alignItems="center"
      marginTop="$-5"
    >
      <Entry
        swatch={
          <YStack
            width={22}
            height={12}
            borderRadius="$2"
            backgroundColor="$primary"
          />
        }
        label={t('legend.run')}
      />
      {/* setup = run colour + a black-0.28 overlay, same recipe as the bar's setup head */}
      <Entry
        swatch={
          <YStack
            width={22}
            height={12}
            borderRadius="$2"
            backgroundColor="$primary"
            overflow="hidden"
          >
            <YStack
              flex={1}
              style={{ backgroundColor: 'rgba(0,0,0,0.28)' }}
            />
          </YStack>
        }
        label={t('legend.setup')}
      />
      <Entry
        swatch={
          <YStack
            width={4}
            height={16}
            borderRadius="$1"
            backgroundColor="$primaryLight"
          />
        }
        label={t('legend.changeover')}
      />
      <Entry
        swatch={
          <YStack
            width={22}
            height={12}
            borderRadius="$2"
            backgroundColor="$primary"
            borderWidth={2}
            borderColor="$danger"
          />
        }
        label={t('legend.atRisk')}
      />
      {/* measured (ml_adjusted) = purple fill — the learned-from-actuals overlay */}
      <Entry
        swatch={
          <YStack
            width={22}
            height={12}
            borderRadius="$2"
            backgroundColor="$ml"
          />
        }
        label={t('legend.measured')}
      />
      {/* predicted (ml_predicted) = amber fill — a pre-adopted forecast, acted ahead of the drift */}
      <Entry
        swatch={
          <YStack
            width={22}
            height={12}
            borderRadius="$2"
            backgroundColor="$warning"
          />
        }
        label={t('legend.predicted')}
      />
      <P
        size={5}
        color="$textSecondary"
      >
        {t('legend.sourceNote')}
      </P>
    </XStack>
  )
}

/** Web board screen — the board body inside the desktop `AdminShell` chrome. */
export function BoardScreen() {
  const { t } = useTranslation('scheduling')
  return (
    <AdminShell
      activeId="board"
      title={t('board.title')}
    >
      <BoardContent />
    </AdminShell>
  )
}
