'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, TriangleAlert } from '@tamagui/lucide-icons'
import type { GanttBar, VarianceChip, WearPrediction } from '@perduraflow/ui'
import type { ChangeSet, WhatIfResultDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppSelect,
  DateRangeNav,
  H,
  KpiTile,
  KpiTileRow,
  P,
  PageHeader,
  Panel,
  ResourceWearPanel,
  ScheduleGantt,
  SegmentedControl,
  useMedia,
  VarianceStrip,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { OpDetailCard } from '../op-detail-card'
import { OperatorAssignControl } from '../operator-assign-control'
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
  useWorkList,
} from '../../../hooks/useScheduling'
import { useDismissPrediction, useLearnedParameters, usePredictions, useVariance } from '../../../hooks/useLearning'
import { useWhatIf } from '../../../hooks/useWhatIf'
import { useToast } from '../../../hooks/useToast'
import { useSessionState } from '../../../hooks/useSessionState'
import { useSetScreenContext } from '../../../stores/screenContext.store'
import { useActivePopup, usePopup } from '../../../stores/popup.store'
import { useDiscussOptions, useSeeOptions } from '../../../hooks/useAtRiskRemediation'
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

/** Roll a weekend day forward to the next working day (Sat→Mon, Sun→Mon); weekdays unchanged. So the
 *  board's default view opens on the upcoming working week, not the spent/weekend one. */
const nextWorkingDay = (ms: number): number => {
  const day = utcDay(ms)
  const dow = new Date(day).getUTCDay()
  return day + (dow === 6 ? 2 : dow === 0 ? 1 : 0) * MS_PER_DAY
}

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
  // Shift-model work-area (C1): Day|Week horizon + the navigated date (UTC-midnight ms). Both default
  // to today's view but are **session-tracked** (web: sessionStorage, so a refresh returns to the last
  // day/horizon; native: in-memory). The default rolls a weekend forward to the next working day so a
  // Sat/Sun rehearsal opens on the upcoming working week (where the open work is), keeping the Gantt
  // and the work-list on the SAME week.
  const [horizonMode, setHorizonMode] = useSessionState<'day' | 'week'>('board.horizonMode', 'day')
  const [viewDate, setViewDate] = useSessionState<number>('board.viewDate', nextWorkingDay(Date.now()))
  // The viewed working week (ISO date) drives the work-list's forward bound — the work-list and the
  // Gantt show the same week. The day/week toggle is Gantt ZOOM only: the work-list's unit is always
  // the week, and a day selection (day mode) is a LENS (emphasis), never a rescope.
  const weekAnchorIso = new Date(weekStartMon(viewDate)).toISOString().slice(0, 10)
  // Same query key as the embedded WorkListTable → React Query dedupes (no extra request). Used for
  // the per-order firm at-risk "Evaluate options" affordance on the op panel.
  const { data: workList } = useWorkList(plantId ?? undefined, versionId ?? undefined, weekAnchorIso)
  const { data: learned = [] } = useLearnedParameters()
  const { data: predictions = [] } = usePredictions(plantId ?? undefined)
  const dismissPred = useDismissPrediction()
  const solve = useSolveSchedule()
  const commit = useCommitSchedule()
  const discard = useDiscardDraft()
  const whatIf = useWhatIf()
  // A SECOND, independent evaluate instance for the demand-change PREVIEW (auto-run on detection) — kept
  // separate from `whatIf` (the on-click option-set popup) so the background preview never flips the
  // popup's pending/result state. Both hit the same deterministic, cached engine, so the "Review impact"
  // click reuses this result (no second solve).
  const previewEval = useWhatIf()
  const runSeeOptions = useSeeOptions()
  const runDiscussOptions = useDiscussOptions()
  const { show: showPopup, hide: hidePopup } = usePopup()
  const activePopup = useActivePopup()
  const media = useMedia()
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResultDto | null>(null)
  const [whatIfError, setWhatIfError] = useState<string | null>(null)
  // The demand-change PREVIEW result (auto-evaluated, never persisted). Drives the banner's impact count
  // AND the board's preview highlight — BOTH read this one result's at-risk set (Addition B: they cannot
  // disagree). Distinct from `whatIfResult` (the on-click popup) so the highlight/banner show without a
  // popup. Cleared when the demand condition resolves (applied or reset) — see the auto-eval effect.
  const [demandPreview, setDemandPreview] = useState<WhatIfResultDto | null>(null)
  // Which condition produced the visible option-set — lets that condition's CTA toggle
  // (See options ⇄ Close options) and collapse what it opened.
  const [whatIfTrigger, setWhatIfTrigger] = useState<string | null>(null)
  const [selectedBarId, setSelectedBarId] = useState<string | null>(null)
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
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

  // KPI strip (D-util headline) — all computed from the committed schedule, no literals. On-time is the
  // CONTINUOUS plant On-Time over the reporting window (same variance payload as Utilization/Throughput
  // and the lane badges, so they reconcile) — a continuous, plan-current view that reflects historical
  // delivery, distinct from the per-version Scorecard OTIF. At-risk derives from the work-list.
  const kpiOps = detail?.operations ?? []
  // Fallback before the variance payload loads: the plan-only on-time fraction (avoids a flash of empty).
  const onTimePct =
    variance?.plantOnTime ?? (kpiOps.length > 0 ? 1 - kpiOps.filter((o) => o.atRisk).length / kpiOps.length : 1)
  // Firm at-risk orders, keyed by demand line, from the WORK-LIST (the order-grain single source the
  // exception queue uses) — NOT the demand endpoint, which omits warm-start/synthetic lines and so
  // can't see every at-risk order. This drives the per-order "Evaluate options" action: it carries the
  // row's causal-chain root (for the root-matched prompt) and the order reference (the prompt label).
  const firmAtRiskByLine = useMemo(
    () =>
      new Map(
        (workList?.rows ?? [])
          .filter((r) => r.status === 'at_risk' && r.firmness === 'firm')
          .map((r) => [r.demandLineId, r])
      ),
    [workList]
  )
  // Canonical at-risk-committed-orders — firm orders currently at-risk from the WORK-LIST status engine
  // (run-aware: a completed order is no longer at-risk). The same count the scorecard tile + baseline
  // "late orders" show. The earlier op-flag count (op.atRisk regardless of run) over-counted completed
  // orders, so it disagreed with the work-list (e.g. 6 here vs work-list 0 once everything had run).
  const atRiskFirmCount = workList?.counts.committedAtRisk ?? 0
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
  // The KPI strip is a plant-state surface → CONTINUOUS historical OEE (A·P·Q over the executed-past
  // Reporting-Policy window, cross-version), which shows immediately from actuals and holds across a
  // re-solve. The per-version OEE/throughput are the scorecard's retrospectives (same two-home split).
  const oeePct = variance?.plantOee?.oee ?? null

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

  // ── Demand-change preview (auto-evaluate; nothing persisted) ────────────────────────────────────
  // A detected demand change auto-runs `evaluate()` (the in-memory what-if) so the impact is ALREADY
  // computed when the banner renders — no manual "re-solve" step (Addition B). The model is hypothetical-
  // ONLY for the PLAN: `demand_input` is already written (the external order revision is a real fact), but
  // no draft/version is created here — the committed plan stays untouched until the planner applies an
  // option. Keyed on the exact demand state (`demandSig`) so it runs once per change and re-runs only when
  // the change differs; cleared when no demand condition remains (applied or reset by the simulator).
  const demandSig = demandConditions
    .map((c) => `${c.demandLineId}:${c.to}`)
    .sort()
    .join('|')
  const evaluatedDemandSig = useRef<string | null>(null)
  useEffect(() => {
    if (readOnly || !plantId) return
    if (demandConditions.length === 0) {
      // Condition resolved (option applied, or simulator reset the qty) → drop the preview + overlay.
      evaluatedDemandSig.current = null
      setDemandPreview(null)
      return
    }
    if (evaluatedDemandSig.current === demandSig) return // already evaluated this exact demand state
    evaluatedDemandSig.current = demandSig
    const changeSet: ChangeSet = {
      origin: { type: 'demand' },
      changes: demandConditions.map((c) => ({ kind: 'demand_qty' as const, demandLineId: c.demandLineId, to: c.to })),
    }
    // mutateAsync (not mutate+onSuccess): StrictMode double-invoke drops a per-call mutate callback, so
    // the preview would never populate on mount. Guard the resolve against a demand state that moved on.
    previewEval
      .mutateAsync({ plantId, changeSet })
      .then((res) => {
        if (evaluatedDemandSig.current === demandSig) setDemandPreview(res)
      })
      .catch(() => {
        if (evaluatedDemandSig.current === demandSig) setDemandPreview(null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on demandSig; previewEval is a stable mutation
  }, [demandSig, readOnly, plantId])

  // The preview's recommended option + its at-risk set (the blast radius) — the ONE source for both the
  // banner count and the board highlight. Fall back to the first feasible option if no recommendation.
  const previewOption = demandPreview
    ? demandPreview.options.find((o) => o.id === demandPreview.recommendedOptionId) ??
      demandPreview.options.find((o) => o.feasible) ??
      null
    : null
  // The change's NEW blast radius: at-risk orders in the hypothetical plan that were NOT already at-risk
  // in the committed baseline. Pre-existing lateness isn't THIS change's consequence — counting it would
  // make an absorbed change read as "impact" and disagree with the Exception Queue's absorbed verdict
  // (which subtracts the same baseline). Absorbed ⇔ this set is empty ⇔ no action needed.
  const previewAtRiskOrders = (previewOption?.atRiskOrders ?? []).filter((o) => !atRiskOrderIds.has(o.demandLineId))
  const previewAtRiskCount = previewAtRiskOrders.length
  // The CHANGED orders themselves (the cause) — kept distinct from their blast radius in the overlay.
  const demandChangeIds = new Set(demandConditions.map((c) => c.demandLineId))
  const previewAtRiskIds = new Set(previewAtRiskOrders.map((o) => o.demandLineId))
  // Transient board overlay (Decision 2): re-colour the COMMITTED bars in place — cause (the changed
  // order) vs blast radius (projected at-risk) — driven by the preview, NOT workList/committedAtRisk, so
  // it stays visually distinct from real committed at-risk and nothing is persisted. The cause highlights
  // immediately (it's the changed order); the consequence fills in once the auto-evaluate lands.
  const previewBars: GanttBar[] = visibleBars.map((b) => ({
    ...b,
    previewCause: b.demandLineId != null && demandChangeIds.has(b.demandLineId),
    previewAtRisk: b.demandLineId != null && previewAtRiskIds.has(b.demandLineId),
  }))
  // Addition D — keep the highlight consistent with the shipped work-list week scoping: highlight what's
  // in the viewed week; surface at-risk orders that fall OUTSIDE it as a count + jump (don't auto-pull the
  // board across weeks). `dueDateIso` is the order's required date (the same key the work-list scopes on).
  const visibleDemandIds = new Set(visibleBars.map((b) => b.demandLineId))
  const outOfWeekAtRisk = previewAtRiskOrders.filter((o) => !visibleDemandIds.has(o.demandLineId))

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
  // Crossing instant per (resource, op) for cycle forecasts — mirrors the overlay gate so planStale can
  // ask "running at/after the crossing?" (plannedEnd > crossingAt), not just "forward of today".
  const crossingByKey = useMemo(
    () =>
      new Map(
        predictions
          .filter((p) => p.param === 'cycle' && p.crossingAt)
          .map((p) => [`${p.resourceId}:${p.routingOperationId}`, new Date(p.crossingAt!).getTime()])
      ),
    [predictions]
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
      if (!l || l.status !== 'held' || l.learnedValue == null || op.cycleSource !== 'standard') return false
      // Mirror the application gate (buildLearnedOverlay): a pre-adopted forecast (`ml_predicted`) keeps an
      // op on `standard` when it STARTS before the crossing — even if it ends after (a "straddle" op that
      // began on the old, un-worn tool). So gate on `plannedStart >= crossingAt`, NOT `plannedEnd`: only an
      // op that STARTS at/after the crossing yet still runs `standard` is genuinely unapplied. Using
      // plannedEnd false-positived the banner on the straddle op (starts pre-crossing, ends post) forever
      // after a clean re-solve. No live crossing → fall back to forward-only. Measured `ml_adjusted` → stale.
      if (l.source !== 'ml_predicted') return true
      const crossing = crossingByKey.get(`${op.resourceId}:${op.routingOperationId}`)
      return crossing != null ? new Date(op.plannedStart).getTime() >= crossing : new Date(op.plannedStart).getTime() >= today
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
  /** Open the option-set for a demand change. REUSE the already-evaluated preview (`demandPreview`) so the
   *  popup's options are exactly the ones the banner counted + the board highlighted (one set, no second
   *  solve). Falls back to a fresh evaluate only if the preview hasn't landed yet. */
  const reviewDemandImpact = (demandLineId: string, to: number) => {
    if (demandPreview) {
      setSelectedBarId(null)
      setSelectedResourceId(null)
      setWhatIfError(null)
      setWhatIfTrigger(`demand-${demandLineId}`)
      setWhatIfResult(demandPreview)
    } else {
      runDemandWhatIf(demandLineId, to)
    }
  }
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
  const fmtH = (min: number) =>
    min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${Math.round(min)}m`

  // ===== Operation panel (click a bar) — OPERATION-LEVEL ONLY =====
  // The op-detail derivation (provenance, learned/predicted, performance, operator, schedule rows)
  // lives in the shared OpDetailCard so the board + work-list render the same card. The board only
  // computes the two board-specific actions below (wear pointer + Evaluate options).

  // A pointer to the line surface when the op's resource has a live forecast (the
  // prediction itself lives on the resource panel, never the op panel).
  const opResourceHasPrediction = selectedOp
    ? predictions.some((p) => p.resourceId === selectedOp.resourceId)
    : false

  // The clicked Gantt bar opens the shared OpDetailCard (the SAME card the work-list drills into). The
  // board supplies the op + its learned record + the two context actions: a wear pointer that jumps to
  // the resource lane (board-only) and the firm-at-risk "Evaluate options" (gated off the work-list row).
  const opPanel = selectedOp ? (
    <OpDetailCard
      op={selectedOp}
      learned={selectedLearned}
      resourceName={resourceName.get(selectedOp.resourceId) ?? ''}
      partNo={partNo.get(selectedOp.partId) ?? selectedOp.partId}
      strandedWindowLabel={selectedStrandedWindowLabel}
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
      seeOptions={(() => {
        const row = !readOnly ? firmAtRiskByLine.get(selectedOp.demandLineId) : undefined
        if (!row) return undefined
        const order = { demandLineId: row.demandLineId, label: row.releaseReference ?? row.demandLineId }
        return { label: t('exceptions:seeOptions'), onPress: () => runSeeOptions(order, setVersionId) }
      })()}
      evaluateOptions={(() => {
        const row = !readOnly ? firmAtRiskByLine.get(selectedOp.demandLineId) : undefined
        if (!row) return undefined
        const order = { demandLineId: row.demandLineId, label: row.releaseReference ?? row.demandLineId }
        return { label: t('exceptions:evaluateOptions'), onPress: () => runDiscussOptions(order) }
      })()}
    />
  ) : null

  // ===== Resource / line wear surface (click a lane) — RESOURCE-LEVEL ONLY =====
  const resName = selectedResourceId ? (resourceName.get(selectedResourceId) ?? '') : ''
  // The line's most relevant cycle forecast. A lane wears as ONE tool even when several routing ops each
  // carry a forecast, so prefer the ACTED one (auto-committed / approved) — the gauge, state, and the
  // Exception Queue's pre-adjusted row then tell ONE story for the lane. Otherwise the most urgent
  // (earliest-crossing) not-yet-acted op.
  const linePred = selectedResourceId
    ? (() => {
        const cyclePreds = predictions.filter((p) => p.resourceId === selectedResourceId && p.param === 'cycle' && p.crossingAt)
        // Among ACTED ops, the STRONGEST (highest-confidence) — the same one the Exception Queue keeps when it
        // collapses a lane's per-op forecasts, so the board gauge and the queue's pre-adjusted row agree.
        const acted = cyclePreds.filter((p) => p.disposition === 'auto_committed' || p.disposition === 'approved')
        return (
          (acted.length ? acted.reduce((a, b) => (b.confidence > a.confidence ? b : a)) : undefined) ??
          [...cyclePreds].sort((a, b) => new Date(a.crossingAt!).getTime() - new Date(b.crossingAt!).getTime())[0]
        )
      })()
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
          // 0 ops overlapping is the RESOLVED state (a reroute/remediation moved the conflicting
          // ops off this line) — say so, instead of the contradictory "0 op(s) … need re-sequencing".
          // The line still shows "down" because the outage is a real fact until it's brought back up.
          body: t(lineOpsN > 0 ? 'board.down.body' : 'board.down.bodyClear', {
            count: lineOpsN,
            resource: resName,
            ...(selectedWindow ? fmtWindow(selectedWindow.from, selectedWindow.to) : { from: '—', to: '—' }),
          }),
        }}
        // No conflicting ops → nothing to remediate, so drop the "See options" CTA (the schedule is
        // already clear of the outage). Bringing the line back up lives in the simulator, not here.
        action={
          readOnly || lineOpsN === 0
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
      <YStack gap="$3">
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
                // Already pre-adjusted (deferred / auto-committed → running worn): the decision is made, so
                // the action is the one thing left to resolve it — Service (reset the tool). A fresh forecast
                // (not yet acted) still reads "See options". Avoids re-presenting service/defer/OT as undecided.
                label: t(wearPreAdjusted ? 'board.pred.serviceCta' : 'whatif:trigger.seeOptions'),
                onPress: () => runWearWhatIf(selectedResourceId!),
                loading: whatIf.isPending,
              }
            : undefined
        }
        emptyText={t('board.pred.healthy')}
      />
      {/* Planner assign/switch operator lever (C5) — current operator + Assign/Switch on the lane. */}
      <OperatorAssignControl
        plantId={plantId ?? undefined}
        resourceId={selectedResourceId}
        planOperator={(detail?.operations ?? []).find((o) => o.resourceId === selectedResourceId && o.operator)?.operator ?? null}
      />
      </YStack>
    ) : null

  // The what-if option-set opens in the SAME global popup as the detail cards (consistent with the
  // at-risk "See options" path) — not inline. It's just another detail-panel source, so it rides the
  // existing show/dismiss machinery below.
  const whatIfPanel = whatIfResult
    ? (() => {
        const committedLate = new Set((detail?.operations ?? []).filter((o) => o.atRisk).map((o) => o.demandLineId)).size
        const absorbed =
          whatIfResult.changeSet.changes.some((c) => c.kind === 'line_down') && whatIfResult.baseKpis.lateOrders <= committedLate
        return (
          <YStack gap="$3">
            {absorbed ? (
              <XStack gap="$2" alignItems="center" backgroundColor="$successSoft" borderRadius="$4" paddingHorizontal="$3" paddingVertical="$2.5">
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
                setVersionId(v)
                setWhatIfResult(null) // clears whatIfPanel → the effect closes the popup
                // CONFIRM (Decision 2): applyOption just persisted the draft. The demand revision was
                // already written at signal time (Addition A retired — no second write to coordinate), so
                // there's nothing to fail-half-way. Clear the preview overlay now (don't wait for the draft
                // refetch to drop the demand condition) so it doesn't linger over the just-applied plan.
                setDemandPreview(null)
                evaluatedDemandSig.current = null
                // A wear remediation applied = the planner DECIDED about this lane's wear (service / defer /
                // OT). Snooze the still-queued forecast so it stops re-surfacing as undecided — on the board
                // AND in the Exception Queue — and re-arms only if the wear gets materially worse (the snooze
                // contract). Keyed on the wear trigger; queued-only (dismiss rejects an auto-committed one).
                if (whatIfTrigger?.startsWith('wear-')) {
                  const rid = whatIfTrigger.slice('wear-'.length)
                  const pred = predictions.find((p) => p.resourceId === rid && p.param === 'cycle' && p.disposition === 'queued')
                  if (pred) dismissPred.mutate(pred.id)
                }
              }}
            />
          </YStack>
        )
      })()
    : null

  // Every click-detail surface opens in the GLOBAL POPUP (usePopup): the op card (a clicked job/bar),
  // the line-down panel, the resource-wear panel (a clicked lane), and the what-if option-set. Content
  // only — each panel carries its own header + actions; the popup just frames it.
  const detailPanel = opPanel ?? whatIfPanel ?? downPanel ?? resourcePanel
  const selectionKey = selectedBarId ?? selectedResourceId ?? whatIfResult?.id ?? null

  // Show the active panel, keyed on the selection (the panel node is a per-render snapshot; re-keying
  // every render would loop the store). The modal scrim blocks the board while open, so the selection
  // only changes via dismiss (or a lane action's runWhatIf, which clears it) — no select→select race.
  const detailPopupOpenRef = useRef(false)
  useEffect(() => {
    if (detailPanel) showPopup({ content: detailPanel, size: whatIfResult ? 'xlarge' : 'medium' })
    // Selection cleared programmatically (e.g. "See options" runs the what-if and clears it) → close.
    else if (detailPopupOpenRef.current) hidePopup()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-show only on selection change; the panel is a snapshot
  }, [selectionKey])

  // When the popup is dismissed (overlay / escape / drag), clear the selection so the same bar/lane
  // can be reopened and the highlight resets. Fire only on the open→closed transition (a fresh
  // selection's show() hasn't applied to the store yet on the same render, so guard on the previous).
  useEffect(() => {
    const wasOpen = detailPopupOpenRef.current
    detailPopupOpenRef.current = Boolean(activePopup)
    if (wasOpen && !activePopup && (selectedBarId || selectedResourceId || whatIfResult)) {
      setSelectedBarId(null)
      setSelectedResourceId(null)
      setWhatIfResult(null) // dismissing the popup also resets the condition-card "See/Close options" toggle
    }
  }, [activePopup, selectedBarId, selectedResourceId, whatIfResult])

  // Leaving the board while the popup is open must not leak it onto the next screen (the popup store
  // is global) — close ours on unmount.
  useEffect(() => () => { if (detailPopupOpenRef.current) hidePopup() }, [hidePopup])

  const conditionCount =
    lineDownConditions.length + demandConditions.length + materialConditions.length

  // The line-down "absorbed" verdict (R2 with-outage ≤ R1 pre-outage → the outage added no new lateness)
  // is computed in `whatIfPanel` above, where the option-set renders (in the popup).

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
            label={t('kpi.oee')}
            value={oeePct == null ? '—' : `${Math.round(oeePct * 100)}%`}
            caption={t('kpi.oeeCaption')}
            valueTone={oeePct == null ? 'neutral' : oeePct >= 0.85 ? 'ok' : oeePct >= 0.6 ? 'warn' : 'bad'}
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
      {detail && (conditionCount > 0 || whatIfError) ? (
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
                // ABSORBED (the auto-evaluate landed with no NEW at-risk): the current plan covers the
                // change with no added lateness — auto-handled, nothing to choose. Show a settled success
                // banner (NO options CTA), consistent with the Exception Queue's "absorbed · no action
                // needed". Only a change that introduces NEW at-risk gets the warning card + options.
                if (demandPreview != null && previewAtRiskCount === 0) {
                  return (
                    <XStack
                      key={`demand-${c.demandLineId}`}
                      gap="$2"
                      alignItems="center"
                      backgroundColor="$successSoft"
                      borderRadius="$4"
                      paddingHorizontal="$3"
                      paddingVertical="$2.5"
                    >
                      <CircleCheck size={15} color="$success" />
                      <P size={4} color="$success">
                        {t('whatif:condition.demandAbsorbed', { line: c.demandLineId, from: c.from, to: c.to })}
                      </P>
                    </XStack>
                  )
                }
                // Impact-result copy (Addition B): once the auto-evaluate has landed, the banner reports the
                // outcome ("N orders at risk") instead of a "re-evaluate" prompt — the evaluation already ran.
                // N reads the SAME preview set the board highlights (the change's NEW at-risk, not pre-existing).
                const detail = demandPreview
                  ? t('whatif:condition.demandDetailImpact', { from: c.from, to: c.to, count: previewAtRiskCount })
                  : t('whatif:condition.demandDetailEvaluating', { from: c.from, to: c.to })
                return (
                  <ConditionCard
                    key={`demand-${c.demandLineId}`}
                    title={t('whatif:condition.demand', { line: c.demandLineId })}
                    detail={detail}
                    cta={open ? t('whatif:trigger.closeOptions') : t('whatif:trigger.reviewImpact')}
                    loading={whatIf.isPending && whatIfTrigger === `demand-${c.demandLineId}`}
                    disabled={readOnly}
                    onPress={() => (open ? closeWhatIf() : reviewDemandImpact(c.demandLineId, c.to))}
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
          {/* Addition D — at-risk orders outside the viewed week aren't auto-pulled into view; surface them
              as a count + jump (consistent with the work-list week scoping). Empty when every impact is in
              the viewed week (e.g. the qty-150 case → all impacts land this week → this never renders). */}
          {outOfWeekAtRisk.length > 0 ? (
            <XStack marginTop="$2" gap="$2" alignItems="center" flexWrap="wrap">
              <P size={4} color="$textSecondary">
                {t('whatif:condition.outOfWeek', { count: outOfWeekAtRisk.length })}
              </P>
              <P
                size={4}
                color="$primary"
                cursor="pointer"
                hoverStyle={{ opacity: 0.8 }}
                onPress={() => {
                  const earliest = outOfWeekAtRisk
                    .map((o) => new Date(o.dueDateIso).getTime())
                    .sort((a, b) => a - b)[0]
                  if (earliest != null) {
                    setViewDate(earliest)
                    setHorizonMode('week')
                  }
                }}
              >
                {t('whatif:condition.outOfWeekJump')}
              </P>
            </XStack>
          ) : null}
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
          {/* The option-set itself renders in the global popup (whatIfPanel), not inline. */}
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
          // The negative margin tucks the controls up against the Gantt by canceling the shell's
          // content gap — only do that on wide layouts (the shell's own >md breakpoint) where the
          // controls sit on a single row. On small layouts they wrap to multiple rows, so keep the
          // shell gap; canceling it there left the controls cramped against the Gantt (no gap).
          marginBottom={media['max-md'] ? undefined : '$-4'}
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
          {/* Horizon toggle + date navigation, grouped together on the right. `marginLeft="auto"` keeps
              the group at the right edge even when it wraps below the version row (where space-between
              would otherwise drop it to the left); `flex-end` right-aligns the items if they wrap. */}
          <XStack
            gap="$3"
            alignItems="center"
            flexWrap="wrap"
            marginLeft="auto"
            justifyContent="flex-end"
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
          bars={previewBars}
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
              ) : bar.stranded ? (
                <P
                  size={4}
                  weight="b"
                  color="$warning"
                >
                  {t('strandedStatus')}
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

      {detail ? <GanttLegend preview={demandPreview != null || demandChangeIds.size > 0} /> : null}

      {/* Click/tap detail (op card / line-down / resource-wear) opens in the global popup — see the
          detailPanel effects above. No inline panel here. */}

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
            weekAnchor={weekAnchorIso}
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

/** Gantt legend — swatches match the bar visuals exactly; source lives here, not in bars. The two
 *  preview entries (cause / projected at-risk) show ONLY while a demand-change preview is active, so the
 *  legend doesn't advertise an overlay that isn't on the board. */
function GanttLegend({ preview = false }: { preview?: boolean }) {
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
      {/* preview · cause (changed order) = solid cyan outline; preview · projected at-risk = dashed amber.
          Both only while a preview is live (transient overlay), matching the bar visuals exactly. */}
      {preview ? (
        <>
          <Entry
            swatch={
              <YStack
                width={22}
                height={12}
                borderRadius="$2"
                backgroundColor="$primary"
                borderWidth={2}
                borderColor="$info"
              />
            }
            label={t('legend.previewCause')}
          />
          <Entry
            swatch={
              <YStack
                width={22}
                height={12}
                borderRadius="$2"
                backgroundColor="$primary"
                borderWidth={2}
                borderColor="$warning"
                style={{ borderStyle: 'dashed' }}
              />
            }
            label={t('legend.previewAtRisk')}
          />
        </>
      ) : null}
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
