import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { G, Line, Svg, Text as SvgText } from 'react-native-svg'
import { useTheme, YStack } from 'tamagui'
import { linearScale, niceTicks } from './scale'
import type { PlotChildren, PlotContext, ValueFormat } from './types'

const MS_DEFAULT_HEIGHT = 200
const M_LEFT = 44
const M_RIGHT = 12
const M_TOP = 10
const M_BOTTOM = 26

/** Props for {@link ChartFrame}. */
export interface ChartFrameProps {
  /** Domain of the x axis `[min, max]` (already niced by the caller if desired). */
  xDomain: [number, number]
  /** Domain of the y axis `[min, max]`. */
  yDomain: [number, number]
  /** Explicit x tick positions (domain units). Omit → no x gridlines/labels (e.g. categorical bars
   *  draw their own labels). */
  xTicks?: number[]
  /** Number of y gridlines/labels (nice ticks computed from `yDomain`). Default 4. */
  yTickCount?: number
  /** Format an x tick label (domain → string). */
  formatX?: ValueFormat
  /** Format a y tick label (domain → string). Default: rounded integer. */
  formatY?: ValueFormat
  /** Fixed height in px. Default 200. */
  height?: number
  /** Explicit width in px — pins the chart to a fixed size and BYPASSES measurement (no
   *  ResizeObserver, no container needed). Omit → responsive: fills the parent's width and
   *  re-lays-out on resize. */
  width?: number
  /** The marks, given the resolved plot scales. */
  children: PlotChildren
  /** Optional Tamagui overlay drawn ABOVE the SVG (hover hit-targets, tooltips). Gets the same plot
   *  scales — absolute-positioned children align to the marks. Web hover works here; SVG can't host it. */
  hud?: (plot: PlotContext) => ReactNode
}

/**
 * ChartFrame — the shared chart scaffold: **responsive width by default** (fills its parent and
 * re-lays-out on resize) or a **pinned `width`** (fixed size, no measurement), a fixed height, axis
 * margins, y gridlines + tick labels, an optional x axis, and a render-prop that hands the plotted
 * child its pixel scales. Built on **`react-native-svg`** (web + native, same as `ScheduleGantt`);
 * colors resolve from the active Tamagui theme. Line/area/bar charts compose this; `Sparkline`
 * deliberately does not (it's chrome-less).
 *
 * @example
 * <ChartFrame xDomain={[0, n]} yDomain={[0, 1]} xTicks={ticks} formatY={pct}>
 *   {({ xScale, yScale, innerH }) => <Polyline points={...} />}
 * </ChartFrame>
 */
export function ChartFrame({ xDomain, yDomain, xTicks, yTickCount = 4, formatX, formatY, height = MS_DEFAULT_HEIGHT, width: fixedWidth, children, hud }: ChartFrameProps) {
  const theme = useTheme()
  const [measuredWidth, setMeasuredWidth] = useState(0)
  // Responsive width (only when `width` isn't pinned). `onLayout` gives the initial measure + native
  // resizes; on web a ResizeObserver also re-measures on container/window resize (RNW's onLayout doesn't
  // always re-fire on a parent resize). ResizeObserver is undefined on native → onLayout-only there.
  const containerRef = useRef<unknown>(null)
  useEffect(() => {
    if (fixedWidth != null) return // pinned width → no measurement
    const el = containerRef.current as Element | null
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setMeasuredWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixedWidth])
  const width = fixedWidth ?? measuredWidth
  const c = {
    grid: theme.borderColor?.val ?? '#232C3D',
    axisText: theme.textTertiary?.val ?? '#7B8494',
    axisLine: theme.borderColor?.val ?? '#232C3D',
  }
  const innerW = Math.max(width - M_LEFT - M_RIGHT, 0)
  const innerH = Math.max(height - M_TOP - M_BOTTOM, 0)
  const xScale = linearScale(xDomain, [M_LEFT, M_LEFT + innerW])
  const yScale = linearScale(yDomain, [M_TOP + innerH, M_TOP]) // inverted: domain-max at the top
  const yTicks = niceTicks(yDomain[0], yDomain[1], yTickCount)
  const fmtY = formatY ?? ((v: number) => `${Math.round(v)}`)
  const plot: PlotContext = { xScale, yScale, innerW, innerH }

  return (
    <YStack
      ref={containerRef as never}
      width={fixedWidth ?? '100%'}
      height={height}
      position="relative"
      onLayout={fixedWidth == null ? (e) => setMeasuredWidth(e.nativeEvent.layout.width) : undefined}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {/* y gridlines + labels */}
          {yTicks.map((t) => {
            const y = yScale(t)
            return (
              <G key={`yt${t}`}>
                <Line x1={M_LEFT} y1={y} x2={M_LEFT + innerW} y2={y} stroke={c.grid} strokeWidth={1} opacity={0.5} />
                <SvgText x={M_LEFT - 6} y={y + 3} fontSize={10} fill={c.axisText} textAnchor="end">
                  {fmtY(t)}
                </SvgText>
              </G>
            )
          })}
          {/* x axis baseline */}
          <Line x1={M_LEFT} y1={M_TOP + innerH} x2={M_LEFT + innerW} y2={M_TOP + innerH} stroke={c.axisLine} strokeWidth={1} />
          {/* x ticks + labels (optional) */}
          {(xTicks ?? []).map((t) => {
            const x = xScale(t)
            return (
              <SvgText key={`xt${t}`} x={x} y={M_TOP + innerH + 16} fontSize={10} fill={c.axisText} textAnchor="middle">
                {formatX ? formatX(t) : `${t}`}
              </SvgText>
            )
          })}
          {/* the marks */}
          {children(plot)}
        </Svg>
      ) : null}
      {/* HUD overlay (hover hit-targets / tooltips) — Tamagui, above the SVG, aligned via the same scales */}
      {width > 0 && hud ? hud(plot) : null}
    </YStack>
  )
}

/** The fixed axis margins {@link ChartFrame} reserves around the plot area — exported so a caller
 *  composing its own overlay can align to the same inner box. */
export const CHART_MARGINS = { left: M_LEFT, right: M_RIGHT, top: M_TOP, bottom: M_BOTTOM } as const
