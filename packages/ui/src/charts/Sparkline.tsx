import { Circle, Polyline, Svg } from 'react-native-svg'
import { useTheme, YStack } from 'tamagui'
import { extent, linearScale, toPolylinePoints } from './scale'
import type { SeriesPoint } from './types'

/** Props for {@link Sparkline}. */
export interface SparklineProps {
  /** Ordered points, or a bare number array (treated as evenly spaced). */
  data: SeriesPoint[] | number[]
  width?: number
  height?: number
  /** Stroke color (theme `.val` hex). Default `$primary`. */
  color?: string
  /** Dot the last point (the "where it ended" read). Default true. */
  markLast?: boolean
}

/**
 * Sparkline — a tiny, chrome-less trend line for inline use (inside a KPI tile, a table cell). No
 * axes, no gridlines, fixed size; just the shape of the recent series. `react-native-svg`, web +
 * native. For a full axed trend use {@link LineChart}.
 *
 * @example <Sparkline data={[3,5,4,6,8]} />
 */
export function Sparkline({ data, width = 88, height = 24, color, markLast = true }: SparklineProps) {
  const theme = useTheme()
  const stroke = color ?? theme.primary?.val ?? '#3f6fd6'
  const points: SeriesPoint[] = typeof data[0] === 'number' ? (data as number[]).map((y, x) => ({ x, y })) : (data as SeriesPoint[])
  if (points.length === 0) return <YStack width={width} height={height} />

  const pad = 2
  const xScale = linearScale(extent(points.map((p) => p.x)), [pad, width - pad])
  const yScale = linearScale(extent(points.map((p) => p.y)), [height - pad, pad]) // inverted
  const px = points.map((p) => ({ x: xScale(p.x), y: yScale(p.y) }))
  const last = px[px.length - 1]!

  return (
    <YStack width={width} height={height}>
      <Svg width={width} height={height}>
        <Polyline points={toPolylinePoints(px)} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {markLast ? <Circle cx={last.x} cy={last.y} r={2} fill={stroke} /> : null}
      </Svg>
    </YStack>
  )
}
