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
interface ActivePopover {
  bar: GanttBar
  anchor: BarAnchor
  pinned: boolean
}

/** A resource row (a line/machine). `subLabel` is an optional second line (e.g. type). */
export interface GanttResource {
  id: string
  label: string
  subLabel?: string
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
  changeover: boolean
  /** Learned (ml_adjusted) cycle/setup → distinct `$ml` fill + a confidence bar (phase 3, FS13). */
  ml?: boolean
  /** 0–1 learned confidence; renders a thin fill bar inside an `ml` bar. */
  confidence?: number | null
}

/** Props for {@link ScheduleGantt}. */
export interface ScheduleGanttProps {
  resources: GanttResource[]
  bars: GanttBar[]
  horizonStartMs: number
  horizonEndMs: number
  /**
   * Detail content for a bar's popover. When provided, hovering a bar previews it
   * and clicking pins it open (with an outside-click scrim). The renderer keeps
   * the gantt presentational — the caller supplies labels/i18n.
   */
  barDetail?: (bar: GanttBar) => ReactNode
  /** Notified when a bar is pinned (selected) or unpinned (null) — drives a side panel. */
  onBarSelect?: (barId: string | null) => void
  emptyText?: string
}

const LABEL_W = 150
const AXIS_H = 38
const LANE_H = 62
const BAR_TOP = 12
const BAR_H = 38
const PX_PER_HOUR = 90
const MIN_TRACK = 480
const LABEL_MIN_W = 74
const MS_PER_HOUR = 3_600_000
/** Minimum hours shown so the track pans forward/back even when the schedule is short. */
const DISPLAY_MIN_HOURS = 14

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
export function ScheduleGantt({ resources, bars, horizonStartMs, horizonEndMs, barDetail, onBarSelect, emptyText }: ScheduleGanttProps) {
  const theme = useTheme()
  const [trackArea, setTrackArea] = useState(0)
  const [active, setActive] = useState<ActivePopover | null>(null)
  if (resources.length === 0) {
    return <EmptyState title={emptyText ?? 'Nothing to schedule'} />
  }
  const showHover = (bar: GanttBar, anchor: BarAnchor) => setActive((cur) => (cur?.pinned ? cur : { bar, anchor, pinned: false }))
  const hideHover = () => setActive((cur) => (cur && !cur.pinned ? null : cur))
  const togglePin = (bar: GanttBar, anchor: BarAnchor) =>
    setActive((cur) => {
      const next = cur?.pinned && cur.bar.id === bar.id ? null : { bar, anchor, pinned: true }
      onBarSelect?.(next ? bar.id : null)
      return next
    })
  const c = {
    bar: theme.primary?.val ?? '#3f6fd6',
    barTop: theme.primaryLight?.val ?? '#5b8def',
    ml: theme.ml?.val ?? '#7c5cff',
    accent: theme.primaryLight?.val ?? '#5b8def',
    danger: theme.danger?.val ?? '#f87171',
    axisBg: theme.surfaceRaised?.val ?? '#1A2030',
    grid: theme.borderColor?.val ?? '#232C3D',
    axisText: theme.textSecondary?.val ?? '#9AA3B2',
    barText: '#FFFFFF',
    laneTint: theme.hoverFill?.val ?? 'rgba(255,255,255,0.03)',
  }

  // Display window: from the horizon start (floored to the hour) to the later of
  // the horizon end and a minimum span, so the track always has room to pan
  // forward/back; gridlines fill it, and it scrolls (hidden bar) when wider than
  // the viewport.
  const displayStart = Math.floor(horizonStartMs / MS_PER_HOUR) * MS_PER_HOUR
  const displayEnd = Math.max(
    Math.ceil(horizonEndMs / MS_PER_HOUR) * MS_PER_HOUR,
    displayStart + DISPLAY_MIN_HOURS * MS_PER_HOUR,
  )
  const spanMs = Math.max(displayEnd - displayStart, MS_PER_HOUR)
  const trackW = Math.max((spanMs / MS_PER_HOUR) * PX_PER_HOUR, trackArea, MIN_TRACK)
  const laneAreaH = resources.length * LANE_H
  const svgH = AXIS_H + laneAreaH
  const rowIndex = new Map(resources.map((r, i) => [r.id, i]))
  const xFor = (ms: number) => ((ms - displayStart) / MS_PER_HOUR) * PX_PER_HOUR

  // hour ticks across the FULL track (so gridlines run all the way across)
  const ticks: number[] = []
  for (let m = displayStart; xFor(m) <= trackW; m += MS_PER_HOUR) ticks.push(m)
  const hhmm = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, '0')}:00`

  return (
    <XStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden" backgroundColor="$surface">
      {/* pinned label column */}
      <YStack width={LABEL_W} borderRightWidth={1} borderRightColor="$borderColor">
        <XStack height={AXIS_H} alignItems="center" paddingHorizontal="$3" backgroundColor="$surfaceRaised" borderBottomWidth={1} borderBottomColor="$borderColor">
          <P size={7} weight="b" color="$textSecondary">
            RESOURCE
          </P>
        </XStack>
        {resources.map((r) => (
          <YStack key={r.id} height={LANE_H} justifyContent="center" paddingHorizontal="$3" borderBottomWidth={1} borderBottomColor="$borderColor">
            <P size={4} weight="m" numberOfLines={1}>
              {r.label}
            </P>
            {r.subLabel ? (
              <P size={7} color="$textSecondary" numberOfLines={1}>
                {r.subLabel}
              </P>
            ) : null}
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
            {/* hour gridlines across the full track + labels */}
            {ticks.map((m) => (
              <Line key={`tk${m}`} x1={xFor(m)} y1={AXIS_H} x2={xFor(m)} y2={svgH} stroke={c.grid} strokeWidth={1} opacity={0.6} />
            ))}
            {ticks.map((m) => (
              <SvgText key={`tl${m}`} x={xFor(m) + 5} y={24} fontSize={11} fill={c.axisText}>
                {hhmm(m)}
              </SvgText>
            ))}
            {/* lanes: alt tint + separators */}
            {resources.map((r, i) => (
              <Rect key={`ln${r.id}`} x={0} y={AXIS_H + i * LANE_H} width={trackW} height={LANE_H} fill={i % 2 === 0 ? c.laneTint : 'transparent'} />
            ))}
            {resources.map((r, i) => (
              <Line key={`ls${r.id}`} x1={0} y1={AXIS_H + i * LANE_H} x2={trackW} y2={AXIS_H + i * LANE_H} stroke={c.grid} strokeWidth={1} />
            ))}
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
                  <Rect x={x} y={y} width={w} height={BAR_H} rx={6} ry={6} fill={b.ml ? c.ml : c.bar} />
                  <G clipPath={`url(#${cid})`}>
                    {setupW > 0 ? <Rect x={x} y={y} width={setupW} height={BAR_H} fill="#000000" opacity={0.28} /> : null}
                    <Rect x={x} y={y} width={w} height={3} fill={b.ml ? '#ffffff' : c.barTop} opacity={b.ml ? 0.5 : 1} />
                    {/* confidence bar (ml only): a settled fill, the convergence read */}
                    {b.ml && b.confidence != null ? (
                      <>
                        <Rect x={x + 6} y={y + BAR_H - 5} width={Math.max(w - 12, 0)} height={2} fill="#ffffff" opacity={0.25} />
                        <Rect x={x + 6} y={y + BAR_H - 5} width={Math.max((w - 12) * b.confidence, 0)} height={2} fill="#ffffff" opacity={0.8} />
                      </>
                    ) : null}
                  </G>
                  {b.atRisk ? <Rect x={x} y={y} width={w} height={BAR_H} rx={6} ry={6} fill="none" stroke={c.danger} strokeWidth={2} /> : null}
                  {b.changeover ? <Rect x={x - 2} y={y - 4} width={3} height={BAR_H + 8} rx={1.5} fill={c.accent} opacity={0.85} /> : null}
                  {b.atRisk ? <Circle cx={x + w - 10} cy={y + 8} r={3.5} fill={c.danger} /> : null}
                  {w >= LABEL_MIN_W ? (
                    <SvgText x={x + 9} y={y + BAR_H / 2 + 4} fontSize={12} fontWeight="500" fill={c.barText}>
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
                  <BarHit key={`hit${b.id}`} bar={b} x={x} y={y} width={w} onHover={showHover} onLeave={hideHover} onPress={togglePin} />
                )
              })
            : null}
        </YStack>
      </ScrollView>

      {/* Popover: hover preview / click-pinned detail, anchored under the bar (Portal escapes clipping) */}
      {active && barDetail ? (
        <Portal>
          {active.pinned ? (
            <YStack position="fixed" top={0} left={0} right={0} bottom={0} zIndex={260000} pointerEvents="auto" onPress={() => setActive(null)} />
          ) : null}
          <YStack
            position="fixed"
            top={active.anchor.y + active.anchor.height + 6}
            left={active.anchor.x}
            maxWidth={300}
            zIndex={260001}
            pointerEvents={active.pinned ? 'auto' : 'none'}
            backgroundColor="$surfaceRaised"
            borderColor="$borderColor"
            borderWidth={1}
            borderRadius="$4"
            padding="$3"
            elevation="$4"
          >
            {barDetail(active.bar)}
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
