import { Defs, LinearGradient, Polygon, Polyline, Stop } from 'react-native-svg'
import { useTheme, YStack } from 'tamagui'
import { ChartFrame } from './ChartFrame'
import { extent, niceDomain, toPolylinePoints } from './scale'
import type { SeriesPoint, ValueFormat } from './types'

/** Props for {@link AreaChart}. */
export interface AreaChartProps {
  data: SeriesPoint[]
  yDomain?: [number, number]
  xTicks?: number[]
  formatX?: ValueFormat
  formatY?: ValueFormat
  /** Line + fill color (theme `.val` hex). Default `$primary`. The fill is a fade of it. */
  color?: string
  height?: number
  /** Explicit width in px — fixed size, bypasses measurement. Omit → responsive (fills parent). */
  width?: number
}

/**
 * AreaChart — a {@link LineChart}-shaped trend with a soft gradient fill to the baseline. Same
 * `react-native-svg` toolkit and {@link ChartFrame} scaffold; use it over a line when the *magnitude
 * under the curve* reads as the story (cumulative throughput, volume). Generic data-in.
 *
 * @example <AreaChart data={series} yDomain={[0, max]} formatY={(v)=>`${v}`} />
 */
export function AreaChart({ data, yDomain, xTicks, formatX, formatY, color, height, width }: AreaChartProps) {
  const theme = useTheme()
  const stroke = color ?? theme.primary?.val ?? '#3f6fd6'
  if (data.length === 0) return <YStack width={width ?? '100%'} height={height ?? 200} />

  const xs = data.map((d) => d.x)
  const ys = data.map((d) => d.y)
  const xDomain = extent(xs)
  const yDom = yDomain ?? niceDomain(Math.min(0, ...ys), Math.max(...ys))
  const ticks = xTicks ?? (data.length > 1 ? [xs[0]!, xs[Math.floor((data.length - 1) / 2)]!, xs[data.length - 1]!] : xs)
  const gradId = 'area-fill'

  return (
    <ChartFrame xDomain={xDomain} yDomain={yDom} xTicks={ticks} formatX={formatX} formatY={formatY} height={height} width={width}>
      {({ xScale, yScale, innerH }) => {
        const pts = data.map((d) => ({ x: xScale(d.x), y: yScale(d.y) }))
        const base = yScale(Math.max(yDom[0], 0))
        const poly = `${pts[0]!.x},${base} ${toPolylinePoints(pts)} ${pts[pts.length - 1]!.x},${base}`
        return (
          <>
            <Defs>
              <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2={`${innerH}`} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={stroke} stopOpacity={0.32} />
                <Stop offset="1" stopColor={stroke} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            <Polygon points={poly} fill={`url(#${gradId})`} stroke="none" />
            <Polyline points={toPolylinePoints(pts)} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )
      }}
    </ChartFrame>
  )
}
