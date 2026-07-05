import { type ReactNode, useState } from 'react'
import { Circle, Polyline } from 'react-native-svg'
import { useTheme, YStack } from 'tamagui'
import { P } from '../typography'
import { ChartFrame } from './ChartFrame'
import { extent, niceDomain, toPolylinePoints } from './scale'
import type { SeriesPoint, ValueFormat } from './types'

/** Props for {@link LineChart}. */
export interface LineChartProps {
  /** Ordered points (`x` numeric — index, day bucket, or epoch ms). */
  data: SeriesPoint[]
  /** Fixed y domain (e.g. `[0, 1]` for a rate). Omit → niced from the data. */
  yDomain?: [number, number]
  /** x tick positions (domain units). Omit → first/middle/last. */
  xTicks?: number[]
  formatX?: ValueFormat
  formatY?: ValueFormat
  /** Stroke color (theme `.val` hex). Default `$primary`. */
  color?: string
  height?: number
  /** Explicit width in px — fixed size, bypasses measurement. Omit → responsive (fills parent). */
  width?: number
  /** Show a dot at each point. Default true when ≤ 24 points. */
  dots?: boolean
  /** Tooltip content for a hovered point (web). Omit → no hover. */
  tooltip?: (point: SeriesPoint) => ReactNode
}

/**
 * LineChart — a continuous trend line on {@link ChartFrame} (responsive width, y gridlines, axes).
 * Built on `react-native-svg` (web + native). Generic: `x` is any ordered numeric (index/day/epoch).
 * Optional per-point hover tooltip on web (a transparent hit column per point, like `ScheduleGantt`).
 *
 * @example <LineChart data={series} yDomain={[0,1]} formatY={(v)=>`${Math.round(v*100)}%`} />
 */
export function LineChart({ data, yDomain, xTicks, formatX, formatY, color, height, width, dots, tooltip }: LineChartProps) {
  const theme = useTheme()
  const [hover, setHover] = useState<{ point: SeriesPoint; x: number; y: number } | null>(null)
  const stroke = color ?? theme.primary?.val ?? '#3f6fd6'
  if (data.length === 0) return <YStack width={width ?? '100%'} height={height ?? 200} />

  const xs = data.map((d) => d.x)
  const ys = data.map((d) => d.y)
  const xDomain = extent(xs)
  const yDom = yDomain ?? niceDomain(...extent(ys))
  const ticks = xTicks ?? (data.length > 1 ? [xs[0]!, xs[Math.floor((data.length - 1) / 2)]!, xs[data.length - 1]!] : xs)
  const showDots = dots ?? data.length <= 24

  return (
    <ChartFrame
      xDomain={xDomain}
      yDomain={yDom}
      xTicks={ticks}
      formatX={formatX}
      formatY={formatY}
      height={height}
      width={width}
      hud={
        tooltip
          ? ({ xScale, yScale, innerW }) => (
              <>
                {hover ? (
                  <YStack
                    position="absolute"
                    left={Math.min(Math.max(hover.x - 70, 0), innerW)}
                    top={Math.max(hover.y - 52, 0)}
                    backgroundColor="$surfaceRaised"
                    borderColor="$borderColor"
                    borderWidth={1}
                    borderRadius="$3"
                    paddingHorizontal="$2"
                    paddingVertical="$1.5"
                    pointerEvents="none"
                    zIndex={10}
                  >
                    {tooltip(hover.point)}
                  </YStack>
                ) : null}
                {data.map((d, i) => {
                  const cx = xScale(d.x)
                  const half = data.length > 1 ? innerW / (data.length - 1) / 2 : innerW / 2
                  return (
                    <YStack
                      key={`hit${i}`}
                      position="absolute"
                      left={cx - half}
                      top={0}
                      width={half * 2}
                      height="100%"
                      cursor="default"
                      // @ts-expect-error Tamagui forwards hover events at runtime; stripped types omit them.
                      onHoverIn={() => setHover({ point: d, x: cx, y: yScale(d.y) })}
                      onHoverOut={() => setHover(null)}
                    />
                  )
                })}
              </>
            )
          : undefined
      }
    >
      {({ xScale, yScale }) => {
        const pts = data.map((d) => ({ x: xScale(d.x), y: yScale(d.y) }))
        return (
          <>
            <Polyline points={toPolylinePoints(pts)} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {showDots ? pts.map((p, i) => <Circle key={`pt${i}`} cx={p.x} cy={p.y} r={2.5} fill={stroke} />) : null}
            {hover ? <Circle cx={hover.x} cy={hover.y} r={4} fill={stroke} stroke="#fff" strokeWidth={1.5} /> : null}
          </>
        )
      }}
    </ChartFrame>
  )
}

/** A compact tooltip body for line/bar hover — a value over a muted caption. */
export function ChartTooltip({ value, caption }: { value: string; caption?: string }) {
  return (
    <>
      <P size={4} weight="b" color="$textPrimary">
        {value}
      </P>
      {caption ? (
        <P size={5} color="$textTertiary">
          {caption}
        </P>
      ) : null}
    </>
  )
}
