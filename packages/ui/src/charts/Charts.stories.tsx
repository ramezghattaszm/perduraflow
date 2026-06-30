import type { Meta, StoryObj } from '@storybook/react'
import { XStack, YStack } from 'tamagui'
import { H, P } from '../typography'
import { AreaChart } from './AreaChart'
import { BarChart } from './BarChart'
import { ChartTooltip, LineChart } from './LineChart'
import { Sparkline } from './Sparkline'

const meta: Meta = { title: 'Charts/Toolkit' }
export default meta
type Story = StoryObj

const pct = (v: number) => `${Math.round(v * 100)}%`
const day = (i: number) => `D${i + 1}`

// A 14-day On-Time-ish trend (rates 0..1), the shape the 902 dashboard will draw.
const onTime = [0.92, 0.94, 0.9, 0.95, 0.97, 0.96, 0.93, 0.98, 0.99, 0.97, 0.95, 0.98, 0.97, 0.99].map((y, x) => ({ x, y }))
const throughput = [120, 132, 128, 141, 150, 147, 139, 158, 162, 155, 149, 161, 158, 166].map((y, x) => ({ x, y }))

export const Line: Story = {
  render: () => (
    <YStack padding="$4" gap="$2" width="100%">
      <P size={5} weight="b" caps color="$textTertiary">
        On-time — 14-day trend (resize the window — the chart re-measures and re-lays-out)
      </P>
      <LineChart
        data={onTime}
        yDomain={[0.8, 1]}
        formatY={pct}
        formatX={(i) => day(i)}
        tooltip={(p) => <ChartTooltip value={pct(p.y)} caption={day(p.x)} />}
      />
    </YStack>
  ),
}

export const Area: Story = {
  render: () => (
    <YStack padding="$4" gap="$2" width="100%">
      <P size={5} weight="b" caps color="$textTertiary">
        Throughput — units/day
      </P>
      <AreaChart data={throughput} formatY={(v) => `${v}`} formatX={(i) => day(i)} />
    </YStack>
  ),
}

export const Bar: Story = {
  render: () => (
    <YStack padding="$4" gap="$2" width="100%">
      <P size={5} weight="b" caps color="$textTertiary">
        Scrap by line — units
      </P>
      <BarChart
        data={[
          { label: 'Press A', value: 12 },
          { label: 'Press B', value: 7 },
          { label: 'Weld 1', value: 19 },
          { label: 'Weld 2', value: 4 },
          { label: 'Assy', value: 9 },
        ]}
        formatY={(v) => `${v}`}
        tooltip={(b) => <ChartTooltip value={`${b.value}`} caption={b.label} />}
      />
    </YStack>
  ),
}

export const Sparklines: Story = {
  render: () => (
    <YStack padding="$4" gap="$3" width={360}>
      <P size={5} weight="b" caps color="$textTertiary">
        Inline sparklines (tile-embedded)
      </P>
      <XStack gap="$4" alignItems="center">
        <YStack gap="$1">
          <P size={4}>On-time</P>
          <Sparkline data={onTime} />
        </YStack>
        <YStack gap="$1">
          <P size={4}>Throughput</P>
          <Sparkline data={throughput.map((d) => d.y)} color="#22c55e" />
        </YStack>
      </XStack>
    </YStack>
  ),
}

/** Explicit fixed width via the `width` prop — pinned size, no container, does NOT track the window. */
export const FixedWidth: Story = {
  render: () => (
    <YStack padding="$4" gap="$3">
      <P size={5} weight="b" caps color="$textTertiary">
        width={'{'}300{'}'} height={'{'}160{'}'} — fixed (resize the window: it stays put)
      </P>
      <XStack gap="$3" flexWrap="wrap">
        <LineChart data={onTime} yDomain={[0.8, 1]} formatY={pct} width={300} height={160} />
        <BarChart data={[{ label: 'A', value: 12 }, { label: 'B', value: 7 }, { label: 'W1', value: 19 }]} formatY={(v) => `${v}`} width={300} height={160} />
      </XStack>
    </YStack>
  ),
}

/** Dashboard tile size — the stop-gate check: the primitives must read cleanly small, on web AND native. */
export const TileSize: Story = {
  render: () => (
    <XStack padding="$4" gap="$3" flexWrap="wrap">
      {[
        { title: 'On-time', node: <LineChart data={onTime} yDomain={[0.8, 1]} formatY={pct} height={120} dots={false} /> },
        { title: 'Throughput', node: <AreaChart data={throughput} formatY={(v) => `${v}`} height={120} /> },
        { title: 'Scrap / line', node: <BarChart data={[{ label: 'A', value: 12 }, { label: 'B', value: 7 }, { label: 'W1', value: 19 }, { label: 'W2', value: 4 }]} formatY={(v) => `${v}`} height={120} /> },
      ].map((tile) => (
        <YStack key={tile.title} width={240} padding="$3" gap="$2" backgroundColor="$surface" borderColor="$borderColor" borderWidth={1} borderRadius="$4">
          <H level={4}>{tile.title}</H>
          {tile.node}
        </YStack>
      ))}
    </XStack>
  ),
}
