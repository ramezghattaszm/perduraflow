import { type ReactNode, useState } from 'react'
import { Rect, Text as SvgText } from 'react-native-svg'
import { useTheme, YStack } from 'tamagui'
import { ChartFrame } from './ChartFrame'
import { niceDomain } from './scale'
import type { BarDatum, ValueFormat } from './types'

const BAR_GAP_FRAC = 0.34 // fraction of a slot left as gap between bars

/** Props for {@link BarChart}. */
export interface BarChartProps {
  data: BarDatum[]
  /** Fixed y domain. Omit → niced from `[0, max]`. */
  yDomain?: [number, number]
  formatY?: ValueFormat
  /** Default bar color (theme `.val` hex); per-bar `color` overrides. Default `$primary`. */
  color?: string
  height?: number
  /** Explicit width in px — fixed size, bypasses measurement. Omit → responsive (fills parent). */
  width?: number
  /** Tooltip content for a hovered bar (web). Omit → no hover. */
  tooltip?: (bar: BarDatum) => ReactNode
}

/**
 * BarChart — categorical bars on {@link ChartFrame} (responsive, y gridlines, category labels under
 * the axis). `react-native-svg`, web + native. Per-bar color override; optional web hover tooltip.
 *
 * @example <BarChart data={[{label:'A',value:3},{label:'B',value:5}]} formatY={(v)=>`${v}`} />
 */
export function BarChart({ data, yDomain, formatY, color, height, width, tooltip }: BarChartProps) {
  const theme = useTheme()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const fill = color ?? theme.primary?.val ?? '#3f6fd6'
  const labelColor = theme.textTertiary?.val ?? '#7B8494'
  if (data.length === 0) return <YStack width={width ?? '100%'} height={height ?? 200} />

  const max = Math.max(...data.map((d) => d.value), 0)
  const yDom = yDomain ?? niceDomain(0, max)
  // Bars are evenly slotted across the x domain [0, n]; each bar centers in its slot.
  const xDomain: [number, number] = [0, data.length]

  return (
    <ChartFrame
      xDomain={xDomain}
      yDomain={yDom}
      formatY={formatY}
      height={height}
      width={width}
      hud={
        tooltip
          ? ({ xScale, yScale, innerW }) => {
              const slotW = innerW / data.length
              return (
                <>
                  {hoverIdx != null && data[hoverIdx] ? (
                    <YStack
                      position="absolute"
                      left={Math.min(Math.max(xScale(hoverIdx + 0.5) - 70, 0), innerW)}
                      top={Math.max(yScale(data[hoverIdx]!.value) - 52, 0)}
                      backgroundColor="$surfaceRaised"
                      borderColor="$borderColor"
                      borderWidth={1}
                      borderRadius="$3"
                      paddingHorizontal="$2"
                      paddingVertical="$1.5"
                      pointerEvents="none"
                      zIndex={10}
                    >
                      {tooltip(data[hoverIdx]!)}
                    </YStack>
                  ) : null}
                  {data.map((d, i) => (
                    <YStack
                      key={`hit${i}`}
                      position="absolute"
                      left={xScale(i)}
                      top={0}
                      width={slotW}
                      height="100%"
                      cursor="default"
                      // @ts-expect-error Tamagui forwards hover events at runtime; stripped types omit them.
                      onHoverIn={() => setHoverIdx(i)}
                      onHoverOut={() => setHoverIdx(null)}
                    />
                  ))}
                </>
              )
            }
          : undefined
      }
    >
      {({ xScale, yScale, innerW }) => {
        const slotW = innerW / data.length
        const barW = slotW * (1 - BAR_GAP_FRAC)
        const base = yScale(yDom[0]) // bottom baseline in absolute SVG coords
        return (
          <>
            {data.map((d, i) => {
              const x = xScale(i) + (slotW - barW) / 2
              const y = yScale(d.value)
              const h = Math.max(base - y, 0)
              return (
                <Rect
                  key={`bar${i}`}
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={3}
                  fill={d.color ?? fill}
                  opacity={hoverIdx == null || hoverIdx === i ? 1 : 0.55}
                />
              )
            })}
            {data.map((d, i) => (
              <SvgText key={`lbl${i}`} x={xScale(i + 0.5)} y={base + 16} fontSize={10} fill={labelColor} textAnchor="middle">
                {d.label}
              </SvgText>
            ))}
          </>
        )
      }}
    </ChartFrame>
  )
}
