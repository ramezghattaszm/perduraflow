import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { P } from './typography'
import { ScheduleGantt } from './ScheduleGantt'

const meta: Meta<typeof ScheduleGantt> = { title: 'Scheduling/ScheduleGantt', component: ScheduleGantt }
export default meta
type Story = StoryObj<typeof ScheduleGantt>

// 06:00..18:00 horizon (UTC)
const origin = Date.UTC(2026, 5, 15, 6)
const end = Date.UTC(2026, 5, 15, 18)
const m = 60_000

export const Default: Story = {
  render: () => (
    <YStack padding="$4">
      <ScheduleGantt
        resources={[
          { id: 'press', label: 'Press Line A', subLabel: 'Stamping' },
          { id: 'weld', label: 'Weld Cell 2', subLabel: 'Welding' },
        ]}
        horizonStartMs={origin}
        horizonEndMs={end}
        barDetail={(b) => <YStack padding="$1"><P size={3}>{b.label}</P></YStack>}
        bars={[
          { id: '1', resourceId: 'press', label: 'FG-1001', sourceTag: 'std', startMs: origin, endMs: origin + 90 * m, setupMin: 20, runMin: 70, atRisk: false, changeover: false },
          { id: '2', resourceId: 'press', label: 'FG-1001', sourceTag: 'std', startMs: origin + 90 * m, endMs: origin + 150 * m, setupMin: 0, runMin: 60, atRisk: false, changeover: false },
          { id: '3', resourceId: 'press', label: 'FG-1003', sourceTag: 'std', startMs: origin + 150 * m, endMs: origin + 260 * m, setupMin: 30, runMin: 80, atRisk: false, changeover: true },
          { id: '4', resourceId: 'press', label: 'FG-1002', sourceTag: 'std', startMs: origin + 260 * m, endMs: origin + 385 * m, setupMin: 30, runMin: 95, atRisk: false, changeover: true },
          { id: '5', resourceId: 'weld', label: 'FG-1001', sourceTag: 'std', startMs: origin + 20 * m, endMs: origin + 90 * m, setupMin: 15, runMin: 55, atRisk: false, changeover: false },
          { id: '6', resourceId: 'weld', label: 'FG-1002', sourceTag: 'std', startMs: origin + 110 * m, endMs: origin + 220 * m, setupMin: 25, runMin: 85, atRisk: false, changeover: true },
          { id: '7', resourceId: 'weld', label: 'FG-1003', sourceTag: 'std', startMs: origin + 330 * m, endMs: origin + 475 * m, setupMin: 25, runMin: 120, atRisk: true, changeover: true },
        ]}
      />
    </YStack>
  ),
}

export const Empty: Story = {
  render: () => (
    <YStack padding="$4">
      <ScheduleGantt resources={[]} bars={[]} horizonStartMs={origin} horizonEndMs={end} emptyText="Nothing scheduled yet." />
    </YStack>
  ),
}

/** Learned (ml) bars — distinct $ml fill + a confidence bar (phase 3). */
export const Learned: Story = {
  render: () => (
    <YStack padding="$4">
      <ScheduleGantt
        resources={[{ id: 'press', label: 'Press Line A', subLabel: 'Stamping', behind: '8% behind plan' }]}
        horizonStartMs={origin}
        horizonEndMs={end}
        bars={[
          { id: '1', resourceId: 'press', label: 'FG-1001', sourceTag: 'ml', startMs: origin, endMs: origin + 95 * m, setupMin: 20, runMin: 75, atRisk: false, changeover: false, ml: true, confidence: 0.82 },
          { id: '2', resourceId: 'press', label: 'FG-1003', sourceTag: 'ml', startMs: origin + 100 * m, endMs: origin + 190 * m, setupMin: 30, runMin: 76, atRisk: false, changeover: true, ml: true, confidence: 0.86 },
          { id: '3', resourceId: 'press', label: 'FG-1002', sourceTag: 'std', startMs: origin + 200 * m, endMs: origin + 325 * m, setupMin: 30, runMin: 95, atRisk: false, changeover: true },
        ]}
      />
    </YStack>
  ),
}
