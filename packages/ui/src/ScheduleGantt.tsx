import { type ComponentProps, type ReactNode, useRef, useState } from 'react'
import { Circle, ClipPath, Defs, G, Line, Rect, Svg, Text as SvgText } from 'react-native-svg'
import { Portal, ScrollView, useTheme, XStack, YStack } from 'tamagui'
import { EmptyState } from './EmptyState'
import { P } from './typography'

// Tamagui forwards hover events at runtime, but the workspace's stripped View
// types omit them; this localized cast adds them (mirrors Tooltip's HoverStack).
type HoverProps = ComponentProps<typeof YStack> & { onHoverIn?: () => void; onHoverOut?: () => void }
const HoverStack = YStack as unknown as (props: HoverProps) => ReactNode

interface Measurable {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void
}
interface BarAnchor {
  x: number
  y: number
  width: number
  height: number
}
/** A transient hover preview (web only) — anchored under the hovered bar. */
interface HoverPreview {
  bar: GanttBar
  anchor: BarAnchor
}

/** A resource row (a line/machine). `subLabel` is an optional second line (e.g. type). */
export interface GanttResource {
  id: string
  label: string
  subLabel?: string
  /** Calm settled signal under the lane name, e.g. "11% behind plan" (BOARD-SIGNALS item 2). */
  behind?: string
  /** Forward-looking settled flag, e.g. "predicted wear ~14:00" (phase 4, FS18) — a
   *  statement, not a live gauge. Shown when there's no `behind` signal. */
  predicted?: string
  /** The line is offline (a "line down" condition) — lane is greyed + tagged DOWN and
   *  shows no bars (its work is stranded until rerouted). */
  down?: boolean
  /** Capacity utilization over the forward window (D-util) — a calm always-on badge, e.g. "81%".
   *  `tone` flags overload: `bad` ≥ 100% (overloaded), `info` < 60% (slack), else `ok`. */
  util?: { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }
}

/**
 * A scheduled operation bar. Times are epoch ms; `setupMin`/`runMin` split the
 * duration so the setup head can be shaded. `changeover` marks an attribute switch
 * from the previous op on the resource. All fields come from existing data — no
 * contract change (the board derives them).
 */
export interface GanttBar {
  id: string
  resourceId: string
  label: string
  /** Business demand line (shown in the press popover). */
  demandLineId?: string
  /** Source tag (e.g. "std") — shown in the tooltip/legend, never inside the bar. */
  sourceTag: string
  startMs: number
  endMs: number
  setupMin: number
  runMin: number
  atRisk: boolean
  /** STRANDED: this op sits inside an active line-down window — it can't run as planned. Rendered
   *  muted + a dashed danger outline ("can't run as planned"), distinct from at-risk's solid outline. */
  stranded?: boolean
  changeover: boolean
  /** Learned (ml_adjusted) cycle/setup → distinct `$ml` fill + a confidence bar (phase 3, FS13). */
  ml?: boolean
  /** Pre-adopted forecast (`ml_predicted`) cycle/setup → distinct amber (`$warning`) fill, no
   *  confidence bar (it's a forecast acted on ahead of the drift, not learned from actuals). */
  predicted?: boolean
  /** 0–1 learned confidence; renders a thin fill bar inside an `ml` bar. */
  confidence?: number | null
}

/**
 * A time-boxed closure on a resource lane (a line-down / maintenance window) — rendered as a
 * danger-tinted hatched region over `[startMs, endMs)`, so the OUTAGE TIMING is visible on the
 * track even when the lane shows no bars. The same window the engine subtracts from capacity.
 */
export interface GanttClosure {
  resourceId: string
  startMs: number
  endMs: number
  /** Optional short label drawn in the region (e.g. "down"). */
  label?: string
}

/** Props for {@link ScheduleGantt}. */
export interface ScheduleGanttProps {
  resources: GanttResource[]
  bars: GanttBar[]
  /** Time-boxed closures (line-down / maintenance) drawn as hatched regions on their lane. */
  closures?: GanttClosure[]
  horizonStartMs: number
  horizonEndMs: number
  /**
   * The plant's daily working window (minutes from UTC midnight, e.g. 360–1320 for
   * 06:00–22:00) from the resources' calendar. When set, the axis spans the working day
   * — opening at shift start (no dead pre-shift period) and closing at shift end (showing
   * open capacity past the last op). Omitted → the axis falls back to the horizon range.
   */
  workingWindow?: { startMinute: number; endMinute: number; workingDays?: number[]; holidays?: string[] } | null
  /**
   * Axis horizon (the FS14 seam): `day` (default) shows one working day at high resolution;
   * `week` shows the Mon–Sun week containing {@link viewDateMs} as a continuous multi-day
   * Gantt — each working day a compressed 06:00–22:00 column, overnight gaps + closed days
   * (Sunday/holiday) rendered as literal gaps/closed columns, work flowing across days.
   */
  horizon?: 'day' | 'week'
  /** The navigated date (UTC-midnight ms): which day (`day`) or which week (`week`) to show.
   *  Falls back to `horizonStartMs`. Requires `workingWindow` for the calendar-aware axis. */
  viewDateMs?: number
  /** Week-mode drill-down: tapping a day column reports its date (UTC-midnight ms). */
  onDaySelect?: (dayMs: number) => void
  /** Shown centered when a `day`-mode view lands on a closed day (Sunday/holiday). */
  closedText?: string
  /** Shown centered when a `day`-mode view is a working day with no scheduled work
   *  (reads as "nothing scheduled", not a broken/blank board). */
  noWorkText?: string
  /**
   * Lightweight **hover preview** content (Tier 1, web only) — a transient tooltip
   * shown while hovering a bar (never on native, which has no hover). Supplementary:
   * every fact here is repeated in the click/tap panel, so nothing is hover-only.
   */
  barDetail?: (bar: GanttBar) => ReactNode
  /** Notified when a bar is selected (its id) or deselected (null) on click/tap —
   *  drives the self-contained detail panel (web) / bottom sheet (native). */
  onBarSelect?: (barId: string | null) => void
  /** The currently selected bar (its detail panel/sheet is open) — drawn with a
   *  selected outline on both platforms. */
  selectedBarId?: string | null
  /** Notified when a resource lane is selected (its id) or deselected (null) — drives
   *  the resource/line wear surface (separate from the operation panel). */
  onResourceSelect?: (resourceId: string | null) => void
  /** The currently selected resource lane (its wear surface is open) — highlighted. */
  selectedResourceId?: string | null
  emptyText?: string
}

const UTIL_BG = { ok: '$successSoft', warn: '$warningSoft', bad: '$dangerSoft', info: '$surfaceRaised' } as const
const UTIL_FG = { ok: '$success', warn: '$warning', bad: '$danger', info: '$textTertiary' } as const
const LABEL_W = 150
const AXIS_H = 38
const LANE_H = 62
const BAR_TOP = 12
const BAR_H = 38
const PX_PER_HOUR = 90
/** Compressed per-hour scale in week mode — working time dominates; 6 days fit ~one viewport. */
const WEEK_PX_PER_HOUR = 11
/** The overnight gap drawn between two adjacent working-day columns (week mode). */
const DAY_GAP = 12
const MIN_TRACK = 480
const LABEL_MIN_W = 74
const MS_PER_HOUR = 3_600_000
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
/** Minimum hours shown so the track pans forward/back even when the schedule is short. */
const DISPLAY_MIN_HOURS = 14

/** A day column on the axis: its working window (epoch ms) + laid-out x/width. */
interface DayCell {
  dayMs: number
  working: boolean
  openMs: number
  closeMs: number
  x: number
  w: number
}

/**
 * ScheduleGantt — read-first Gantt (scheduling spec / GANTT-FIX-NOTE). Bars are
 * **positioned by `planned_start` and sized by duration** on an hour axis with
 * gridlines that span the full track. The setup head is shaded, a changeover
 * attribute-switch shows a thin accent tick, and at-risk bars get a `$danger`
 * inset border + dot (not a different fill). Bars are rounded on all corners
 * (overlays clipped). Source/confidence live in the legend + press tooltip, never
 * inside a bar. Built on **`react-native-svg`** so the same component renders web
 * AND native/iPad; colours come from the active Tamagui theme. The resource-label
 * column is pinned; the time track scrolls horizontally and fills the viewport.
 *
 * @example
 * <ScheduleGantt resources={rows} bars={bars} horizonStartMs={s} horizonEndMs={e} onBarPress={open} />
 */
export function ScheduleGantt({ resources, bars, closures, horizonStartMs, horizonEndMs, workingWindow, horizon = 'day', viewDateMs, onDaySelect, closedText, noWorkText, barDetail, onBarSelect, selectedBarId, onResourceSelect, selectedResourceId, emptyText }: ScheduleGanttProps) {
  const theme = useTheme()
  const [trackArea, setTrackArea] = useState(0)
  // Hover preview only (web). The selected/open bar is owned by the parent
  // (`selectedBarId`) and drives the persistent panel / bottom sheet — clicking a
  // bar never pins an occluding popover over the schedule.
  const [hover, setHover] = useState<HoverPreview | null>(null)
  if (resources.length === 0) {
    return <EmptyState title={emptyText ?? 'Nothing to schedule'} />
  }
  const showHover = (bar: GanttBar, anchor: BarAnchor) => setHover({ bar, anchor })
  const hideHover = () => setHover(null)
  const selectBar = (bar: GanttBar) => {
    setHover(null) // a click resolves the preview into the panel; don't linger
    onBarSelect?.(selectedBarId === bar.id ? null : bar.id)
  }
  const c = {
    bar: theme.primary?.val ?? '#3f6fd6',
    barTop: theme.primaryLight?.val ?? '#5b8def',
    ml: theme.ml?.val ?? '#7c5cff',
    predicted: theme.warning?.val ?? '#D97706',
    accent: theme.primaryLight?.val ?? '#5b8def',
    danger: theme.danger?.val ?? '#f87171',
    selected: theme.primary?.val ?? '#3f6fd6',
    axisBg: theme.surfaceRaised?.val ?? '#1A2030',
    grid: theme.borderColor?.val ?? '#232C3D',
    axisText: theme.textTertiary?.val ?? '#7B8494',
    barText: '#FFFFFF',
    laneTint: theme.hoverFill?.val ?? 'rgba(255,255,255,0.03)',
  }

  const startOfDay = (ms: number) => Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
  const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const weekMode = horizon === 'week'

  // ── Axis model ────────────────────────────────────────────────────────────
  // With a calendar working window the axis is built from **day cells**: each working day
  // is its 06:00–22:00 span (compressed in week mode), closed days are thin "Closed"
  // columns, and the overnight gap is a literal gutter between days. One mechanism drives
  // both day mode (a single cell at high resolution) and week mode (Mon–Sun). Without a
  // working window it falls back to the legacy linear horizon axis (no calendar known).
  let cells: DayCell[] = []
  let contentW: number
  let xFor: (ms: number) => number
  let linearTicks: number[] = []

  if (workingWindow) {
    const openMin = workingWindow.startMinute
    const closeMin = workingWindow.endMinute
    const workingDays = workingWindow.workingDays ?? [0, 1, 2, 3, 4, 5, 6]
    const holidays = new Set(workingWindow.holidays ?? [])
    const isWorkingDay = (dayMs: number) => workingDays.includes(new Date(dayMs).getUTCDay()) && !holidays.has(dateKey(dayMs))
    const pph = weekMode ? WEEK_PX_PER_HOUR : PX_PER_HOUR

    const base = startOfDay(viewDateMs ?? horizonStartMs)
    const days = weekMode
      ? Array.from({ length: 7 }, (_, i) => base - ((new Date(base).getUTCDay() + 6) % 7) * MS_PER_DAY + i * MS_PER_DAY)
      : [base]

    let x = 0
    cells = days.map((dayMs, i) => {
      if (i > 0) x += weekMode ? DAY_GAP : 0
      const working = isWorkingDay(dayMs)
      const openMs = dayMs + openMin * MS_PER_MINUTE
      let closeMs = dayMs + closeMin * MS_PER_MINUTE
      if (working) {
        const dayEnd = dayMs + MS_PER_DAY
        for (const b of bars) if (b.startMs >= dayMs && b.startMs < dayEnd && b.endMs > closeMs) closeMs = b.endMs
      }
      // A closed DAY renders at full working-day width (a whole day is closed), so it reads
      // as a complete hatched day column — not a thin sliver. (Overnight gaps stay thin.)
      const fullDayW = ((closeMin - openMin) / 60) * pph
      const w = working ? Math.max(((closeMs - openMs) / MS_PER_HOUR) * pph, 1) : weekMode ? fullDayW : Math.max(fullDayW, MIN_TRACK)
      const cell: DayCell = { dayMs, working, openMs, closeMs, x, w }
      x += w
      return cell
    })
    contentW = x
    xFor = (ms: number) => {
      for (const cell of cells) {
        if (ms >= cell.dayMs && ms < cell.dayMs + MS_PER_DAY) {
          if (!cell.working) return cell.x
          const t = (ms - cell.openMs) / Math.max(cell.closeMs - cell.openMs, 1)
          return cell.x + Math.max(0, Math.min(1, t)) * cell.w
        }
      }
      return ms < (cells[0]?.dayMs ?? 0) ? 0 : contentW
    }
  } else {
    // Legacy linear axis (no calendar): hour scale over the horizon, min pannable span.
    const displayStart = Math.floor(horizonStartMs / MS_PER_HOUR) * MS_PER_HOUR
    const displayEnd = Math.max(Math.ceil(horizonEndMs / MS_PER_HOUR) * MS_PER_HOUR, displayStart + DISPLAY_MIN_HOURS * MS_PER_HOUR)
    contentW = ((displayEnd - displayStart) / MS_PER_HOUR) * PX_PER_HOUR
    xFor = (ms: number) => ((ms - displayStart) / MS_PER_HOUR) * PX_PER_HOUR
    for (let m = displayStart; xFor(m) <= contentW; m += MS_PER_HOUR) linearTicks.push(m)
  }

  const trackW = Math.max(contentW, trackArea, MIN_TRACK)
  // Day-mode hour ticks (within the single working cell); week mode uses day headers instead.
  const dayCell = !weekMode && cells.length === 1 ? cells[0]! : null
  const hourTicks: number[] = []
  if (dayCell?.working) for (let m = dayCell.openMs; m <= dayCell.closeMs; m += MS_PER_HOUR) hourTicks.push(m)
  // A day-mode view that landed on a closed day → show the "closed" empty state.
  const dayClosed = !weekMode && cells.length === 1 && !cells[0]!.working

  const laneAreaH = resources.length * LANE_H
  const svgH = AXIS_H + laneAreaH
  const rowIndex = new Map(resources.map((r, i) => [r.id, i]))
  const hhmm = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, '0')}:00`
  const dayHeader = (ms: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ms))
  // Diagonal hatch filling a closed-day column (the "unavailable" Gantt convention) — 45°
  // anti-diagonals clipped to the column box by min/max (no clipPath needed).
  const closedHatch = (cell: DayCell): ReactNode[] => {
    const x = cell.x
    const y = AXIS_H
    const w = cell.w
    const h = laneAreaH
    const step = 7
    const lines: ReactNode[] = []
    for (let o = step; o < w + h; o += step) {
      lines.push(
        <Line
          key={`hx${cell.dayMs}-${o}`}
          x1={x + Math.max(0, o - h)}
          y1={y + Math.min(o, h)}
          x2={x + Math.min(o, w)}
          y2={y + Math.max(0, o - w)}
          stroke={c.axisText}
          strokeWidth={1}
          opacity={0.55}
        />,
      )
    }
    return lines
  }

  return (
    <XStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden" backgroundColor="$surface">
      {/* pinned label column */}
      <YStack width={LABEL_W} borderRightWidth={1} borderRightColor="$borderColor">
        <XStack height={AXIS_H} alignItems="center" paddingHorizontal="$3" backgroundColor="$surfaceRaised" borderBottomWidth={1} borderBottomColor="$borderColor">
          <P size={5} weight="b" caps color="$textTertiary">
            RESOURCE
          </P>
        </XStack>
        {resources.map((r) => (
          <YStack
            key={r.id}
            height={LANE_H}
            justifyContent="center"
            paddingHorizontal="$3"
            borderBottomWidth={1}
            borderBottomColor="$borderColor"
            gap="$1"
            backgroundColor={selectedResourceId === r.id ? '$primarySoft' : undefined}
            cursor={onResourceSelect ? 'pointer' : undefined}
            hoverStyle={onResourceSelect ? { backgroundColor: selectedResourceId === r.id ? '$primarySoft' : '$hoverFill' } : undefined}
            onPress={onResourceSelect ? () => onResourceSelect(selectedResourceId === r.id ? null : r.id) : undefined}
          >
            <P size={3} weight="m" numberOfLines={1} color={r.down ? '$textTertiary' : selectedResourceId === r.id ? '$primary' : '$textPrimary'}>
              {r.label}
            </P>
            {(
              <XStack gap="$1" alignItems="center" flexWrap="wrap">
                {/* DOWN tag (line-down / maintenance in effect). Sits alongside util — the lane is
                    down AND its closure-adjusted capacity is still worth a glance. */}
                {r.down ? (
                  <XStack backgroundColor="$dangerSoft" borderRadius="$2" paddingHorizontal="$1.5" paddingVertical="$0.5">
                    <P size={5} weight="b" caps color="$danger" numberOfLines={1}>
                      down
                    </P>
                  </XStack>
                ) : null}
                {/* Utilization — always-on capacity badge; bad ≥100% = the red "overloaded" glance. */}
                {r.util ? (
                  <XStack backgroundColor={UTIL_BG[r.util.tone]} borderRadius="$2" paddingHorizontal="$1.5" paddingVertical="$0.5">
                    <P size={5} weight="b" color={UTIL_FG[r.util.tone]} numberOfLines={1}>
                      {r.util.label}
                    </P>
                  </XStack>
                ) : null}
                {/* Anomaly signal alongside util (behind > predicted), else the plain sublabel. SUPPRESSED
                    on a DOWN lane — DOWN is the dominant signal and the longer text would wrap the header. */}
                {r.down ? null : r.behind ? (
                  <XStack backgroundColor="$dangerSoft" borderRadius="$2" paddingHorizontal="$1.5" paddingVertical="$0.5">
                    <P size={5} weight="b" color="$danger" numberOfLines={1}>
                      {r.behind}
                    </P>
                  </XStack>
                ) : r.predicted ? (
                  <XStack backgroundColor="$warningSoft" borderRadius="$2" paddingHorizontal="$1.5" paddingVertical="$0.5">
                    <P size={5} weight="b" color="$warning" numberOfLines={1}>
                      {r.predicted}
                    </P>
                  </XStack>
                ) : !r.util && r.subLabel ? (
                  <P size={5} color="$textSecondary" numberOfLines={1}>
                    {r.subLabel}
                  </P>
                ) : null}
              </XStack>
            )}
          </YStack>
        ))}
      </YStack>

      {/* scrollable time track (flex-bounded so it scrolls internally; hidden scrollbar) */}
      <ScrollView flex={1} horizontal showsHorizontalScrollIndicator={false} onLayout={(e) => setTrackArea(e.nativeEvent.layout.width)}>
        <YStack width={trackW} height={svgH} position="relative">
          <Svg width={trackW} height={svgH}>
            {/* axis header band (matches the RESOURCE corner) */}
            <Rect x={0} y={0} width={trackW} height={AXIS_H} fill={c.axisBg} />
            <Line x1={0} y1={AXIS_H} x2={trackW} y2={AXIS_H} stroke={c.grid} strokeWidth={1} />
            {/* lanes: alt tint + separators (drawn first so closed-day fills overlay them) */}
            {resources.map((r, i) => (
              <Rect key={`ln${r.id}`} x={0} y={AXIS_H + i * LANE_H} width={trackW} height={LANE_H} fill={i % 2 === 0 ? c.laneTint : 'transparent'} />
            ))}
            {resources.map((r, i) => (
              <Line key={`ls${r.id}`} x1={0} y1={AXIS_H + i * LANE_H} x2={trackW} y2={AXIS_H + i * LANE_H} stroke={c.grid} strokeWidth={1} />
            ))}
            {/* axis structure: week = day columns (overnight gaps + closed days + date headers);
                day = hour gridlines + labels; no calendar = legacy hour ticks */}
            {workingWindow && weekMode ? (
              cells.map((cell, i) => (
                <G key={`cell${cell.dayMs}`}>
                  {i > 0 ? <Rect x={cell.x - DAY_GAP} y={AXIS_H} width={DAY_GAP} height={laneAreaH} fill={c.grid} opacity={0.18} /> : null}
                  {/* Closed day (Sunday/holiday): a solid opaque base (wipes the alternating
                      lane tint so the whole column reads uniformly) + a grey tint + diagonal
                      hatch = clearly "not available", no label (the date header carries the day). */}
                  {!cell.working ? (
                    <>
                      <Rect x={cell.x} y={AXIS_H} width={cell.w} height={laneAreaH} fill={c.axisBg} opacity={1} />
                      <Rect x={cell.x} y={AXIS_H} width={cell.w} height={laneAreaH} fill={c.axisText} opacity={0.28} />
                      {closedHatch(cell)}
                    </>
                  ) : null}
                  <Line x1={cell.x} y1={0} x2={cell.x} y2={svgH} stroke={c.grid} strokeWidth={1} />
                  <SvgText x={cell.x + (cell.working ? 6 : cell.w / 2)} y={24} fontSize={11} fontWeight="600" fill={c.axisText} textAnchor={cell.working ? 'start' : 'middle'} opacity={cell.working ? 1 : 0.6}>
                    {dayHeader(cell.dayMs)}
                  </SvgText>
                </G>
              ))
            ) : workingWindow ? (
              <>
                {hourTicks.map((m) => (
                  <Line key={`tk${m}`} x1={xFor(m)} y1={AXIS_H} x2={xFor(m)} y2={svgH} stroke={c.grid} strokeWidth={1} opacity={0.6} />
                ))}
                {hourTicks.map((m) => (
                  <SvgText key={`tl${m}`} x={xFor(m) + 5} y={24} fontSize={11} fill={c.axisText}>
                    {hhmm(m)}
                  </SvgText>
                ))}
                {dayClosed ? <Rect x={0} y={AXIS_H} width={trackW} height={laneAreaH} fill={c.grid} opacity={0.15} /> : null}
              </>
            ) : (
              <>
                {linearTicks.map((m) => (
                  <Line key={`tk${m}`} x1={xFor(m)} y1={AXIS_H} x2={xFor(m)} y2={svgH} stroke={c.grid} strokeWidth={1} opacity={0.6} />
                ))}
                {linearTicks.map((m) => (
                  <SvgText key={`tl${m}`} x={xFor(m) + 5} y={24} fontSize={11} fill={c.axisText}>
                    {hhmm(m)}
                  </SvgText>
                ))}
              </>
            )}
            {/* closures (line-down / maintenance): a danger-tinted hatched region on the lane over
                [start, end), so the outage TIMING is visible on the track (the lane shows no bars). */}
            {(closures ?? []).map((cl, ci) => {
              const ri = rowIndex.get(cl.resourceId)
              if (ri === undefined) return null
              const x0 = Math.max(0, Math.min(xFor(cl.startMs), trackW))
              const x1 = Math.max(0, Math.min(xFor(cl.endMs), trackW))
              const w = x1 - x0
              if (w <= 1) return null
              const y = AXIS_H + ri * LANE_H
              const step = 7
              const hatch: ReactNode[] = []
              for (let o = step; o < w + LANE_H; o += step) {
                hatch.push(
                  <Line
                    key={`clh${ci}-${o}`}
                    x1={x0 + Math.max(0, o - LANE_H)}
                    y1={y + Math.min(o, LANE_H)}
                    x2={x0 + Math.min(o, w)}
                    y2={y + Math.max(0, o - w)}
                    stroke={c.danger}
                    strokeWidth={1}
                    opacity={0.35}
                  />,
                )
              }
              return (
                <G key={`cl${ci}`}>
                  <Rect x={x0} y={y} width={w} height={LANE_H} fill={c.danger} opacity={0.1} />
                  {hatch}
                  <Line x1={x0} y1={y} x2={x0} y2={y + LANE_H} stroke={c.danger} strokeWidth={2} opacity={0.85} />
                  {cl.label && w > 34 ? (
                    <SvgText x={x0 + 6} y={y + LANE_H / 2 + 4} fontSize={11} fontWeight="600" fill={c.danger} opacity={0.9}>
                      {cl.label}
                    </SvgText>
                  ) : null}
                </G>
              )
            })}
            {/* bars (rounded all around; setup + top-stripe clipped to the rounded shape) */}
            {bars.map((b) => {
              const ri = rowIndex.get(b.resourceId)
              if (ri === undefined) return null
              const x = xFor(b.startMs)
              const w = Math.max(xFor(b.endMs) - x, 6)
              const y = AXIS_H + ri * LANE_H + BAR_TOP
              const total = b.setupMin + b.runMin
              const setupW = total > 0 ? Math.min((b.setupMin / total) * w, w) : 0
              const cid = `clip-${b.id}`
              return (
                <G key={`bar${b.id}`}>
                  <Defs>
                    <ClipPath id={cid}>
                      <Rect x={x} y={y} width={w} height={BAR_H} rx={6} ry={6} />
                    </ClipPath>
                  </Defs>
                  <Rect x={x} y={y} width={w} height={BAR_H} rx={6} ry={6} fill={b.ml ? c.ml : b.predicted ? c.predicted : c.bar} />
                  <G clipPath={`url(#${cid})`}>
                    {setupW > 0 ? <Rect x={x} y={y} width={setupW} height={BAR_H} fill="#000000" opacity={0.28} /> : null}
                    <Rect
                      x={x}
                      y={y}
                      width={w}
                      height={3}
                      fill={b.ml || b.predicted ? '#ffffff' : c.barTop}
                      opacity={b.ml || b.predicted ? 0.5 : 1}
                    />
                    {/* confidence bar (ml only): a settled fill, the convergence read */}
                    {b.ml && b.confidence != null ? (
                      <>
                        <Rect x={x + 6} y={y + BAR_H - 5} width={Math.max(w - 12, 0)} height={2} fill="#ffffff" opacity={0.25} />
                        <Rect x={x + 6} y={y + BAR_H - 5} width={Math.max((w - 12) * b.confidence, 0)} height={2} fill="#ffffff" opacity={0.8} />
                      </>
                    ) : null}
                    {/* stranded: a muted wash — this op can't run as planned (line down in its slot) */}
                    {b.stranded ? <Rect x={x} y={y} width={w} height={BAR_H} fill={c.axisBg} opacity={0.55} /> : null}
                  </G>
                  {b.atRisk ? <Rect x={x} y={y} width={w} height={BAR_H} rx={6} ry={6} fill="none" stroke={c.danger} strokeWidth={2} /> : null}
                  {/* stranded (and not already at-risk): a DASHED danger outline — "can't run as planned",
                      distinct from at-risk's solid outline. */}
                  {b.stranded && !b.atRisk ? (
                    <Rect x={x} y={y} width={w} height={BAR_H} rx={6} ry={6} fill="none" stroke={c.danger} strokeWidth={2} strokeDasharray="4 3" />
                  ) : null}
                  {b.changeover ? <Rect x={x - 2} y={y - 4} width={3} height={BAR_H + 8} rx={1.5} fill={c.accent} opacity={0.85} /> : null}
                  {b.atRisk ? <Circle cx={x + w - 10} cy={y + 8} r={3.5} fill={c.danger} /> : null}
                  {/* selected state — an outset ring while this bar's panel/sheet is open */}
                  {selectedBarId === b.id ? (
                    <Rect x={x - 3} y={y - 3} width={w + 6} height={BAR_H + 6} rx={9} ry={9} fill="none" stroke={c.selected} strokeWidth={2.5} />
                  ) : null}
                  {w >= LABEL_MIN_W ? (
                    <SvgText x={x + 9} y={y + BAR_H / 2 + 4} fontSize={11} fontWeight="500" fill={c.barText}>
                      {b.label}
                    </SvgText>
                  ) : null}
                </G>
              )
            })}
          </Svg>
          {/* Hover/press hit-targets over each bar (Tamagui — reliable web+native) */}
          {barDetail
            ? bars.map((b) => {
                const ri = rowIndex.get(b.resourceId)
                if (ri === undefined) return null
                const x = xFor(b.startMs)
                const w = Math.max(xFor(b.endMs) - x, 6)
                const y = AXIS_H + ri * LANE_H + BAR_TOP
                return (
                  <BarHit key={`hit${b.id}`} bar={b} x={x} y={y} width={w} onHover={showHover} onLeave={hideHover} onPress={selectBar} />
                )
              })
            : null}
          {/* Week mode: each day column is a drill target → switch to day mode on that date. */}
          {weekMode && onDaySelect
            ? cells.map((cell) => (
                <YStack
                  key={`drill${cell.dayMs}`}
                  position="absolute"
                  left={cell.x}
                  top={0}
                  width={cell.w}
                  height={AXIS_H}
                  cursor="pointer"
                  hoverStyle={{ backgroundColor: '$hoverFill' }}
                  onPress={() => onDaySelect(cell.dayMs)}
                />
              ))
            : null}
          {/* Day mode → centered message when there's nothing to show: a closed day
              (Sunday/holiday) or a working day with no scheduled work. Reads as
              intentional ("nothing scheduled"), not a broken/blank board. */}
          {!weekMode && (dayClosed ? closedText : bars.length === 0 ? noWorkText : null) ? (
            <YStack position="absolute" top={AXIS_H} left={0} right={0} height={laneAreaH} alignItems="center" justifyContent="center" pointerEvents="none">
              <P size={3} weight="m" color="$textTertiary">
                {dayClosed ? closedText : noWorkText}
              </P>
            </YStack>
          ) : null}
        </YStack>
      </ScrollView>

      {/* Hover preview (Tier 1, web only) — transient, anchored under the bar, never
          interactive (pointerEvents none). Native has no hover, so it never shows;
          the click/tap panel carries every fact. Portal escapes the scroll clip. */}
      {hover && barDetail ? (
        <Portal>
          <YStack
            position="fixed"
            top={hover.anchor.y + hover.anchor.height + 6}
            left={hover.anchor.x}
            maxWidth={300}
            zIndex={260001}
            pointerEvents="none"
            backgroundColor="$surfaceRaised"
            borderColor="$borderColor"
            borderWidth={1}
            borderRadius="$4"
            padding="$3"
            elevation="$4"
          >
            {barDetail(hover.bar)}
          </YStack>
        </Portal>
      ) : null}
    </XStack>
  )
}

/** Per-bar hover/press hit-target that reports its window-anchor for the popover. */
function BarHit({
  bar,
  x,
  y,
  width,
  onHover,
  onLeave,
  onPress,
}: {
  bar: GanttBar
  x: number
  y: number
  width: number
  onHover: (bar: GanttBar, anchor: BarAnchor) => void
  onLeave: () => void
  onPress: (bar: GanttBar, anchor: BarAnchor) => void
}) {
  const ref = useRef<Measurable | null>(null)
  const measure = (cb: (a: BarAnchor) => void) =>
    ref.current?.measureInWindow?.((mx, my, mw, mh) => cb({ x: mx, y: my, width: mw, height: mh }))
  return (
    <HoverStack
      ref={ref as never}
      position="absolute"
      left={x}
      top={y}
      width={width}
      height={BAR_H}
      cursor="pointer"
      onHoverIn={() => measure((a) => onHover(bar, a))}
      onHoverOut={onLeave}
      onPress={() => measure((a) => onPress(bar, a))}
    />
  )
}
