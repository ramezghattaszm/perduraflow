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

/** Line-down closure — a danger-tinted hatched region marks the outage window on the down lane,
 *  which is tagged DOWN and shows no bars (its work displaced to the other lane). */
export const LineDownClosure: Story = {
  render: () => (
    <YStack padding="$4">
      <ScheduleGantt
        resources={[
          { id: 'press', label: 'Press Line A', subLabel: 'Stamping', down: true },
          { id: 'pressb', label: 'Press Line B', subLabel: 'Stamping', util: { label: '92%', tone: 'ok' } },
        ]}
        horizonStartMs={origin}
        horizonEndMs={end}
        closures={[{ resourceId: 'press', startMs: origin + 120 * m, endMs: end, label: 'down' }]}
        bars={[
          { id: 'b1', resourceId: 'pressb', label: 'FG-1001', sourceTag: 'std', startMs: origin, endMs: origin + 130 * m, setupMin: 20, runMin: 110, atRisk: false, changeover: false },
          { id: 'b2', resourceId: 'pressb', label: 'FG-1003', sourceTag: 'std', startMs: origin + 130 * m, endMs: origin + 300 * m, setupMin: 30, runMin: 140, atRisk: true, changeover: true },
        ]}
      />
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
          // predicted (ml_predicted) = amber fill — a pre-adopted forecast, no confidence bar
          { id: '3', resourceId: 'press', label: 'FG-1002', sourceTag: 'predicted', startMs: origin + 200 * m, endMs: origin + 295 * m, setupMin: 30, runMin: 65, atRisk: false, changeover: true, predicted: true },
          { id: '4', resourceId: 'press', label: 'FG-1004', sourceTag: 'std', startMs: origin + 305 * m, endMs: origin + 420 * m, setupMin: 30, runMin: 85, atRisk: false, changeover: false },
        ]}
      />
    </YStack>
  ),
}

const DAY = 86_400_000
const mon = Date.UTC(2026, 5, 15) // Monday
const ww = { startMinute: 360, endMinute: 1320, workingDays: [1, 2, 3, 4, 5, 6], holidays: [] }
const work = (day: number, h: number) => day + h * 3_600_000

/** Week view — continuous Mon–Sun; overnight gaps + Sunday closed as literal gaps/columns;
 *  work flows across days; compressed scale (day headers, no hourly ticks). */
export const Week: Story = {
  render: () => (
    <YStack padding="$4">
      <ScheduleGantt
        horizon="week"
        viewDateMs={mon}
        workingWindow={ww}
        resources={[
          { id: 'pa', label: 'Press Line A', subLabel: 'Stamping' },
          { id: 'pb', label: 'Press Line B', subLabel: 'Stamping' },
        ]}
        horizonStartMs={mon}
        horizonEndMs={mon + 3 * DAY}
        barDetail={(b) => <YStack padding="$1"><P size={3}>{b.label}</P></YStack>}
        bars={[
          { id: '1', resourceId: 'pa', label: 'GP-1142', sourceTag: 'std', startMs: work(mon, 6), endMs: work(mon, 12), setupMin: 30, runMin: 330, atRisk: false, changeover: false },
          { id: '2', resourceId: 'pa', label: 'DL-1004', sourceTag: 'std', startMs: work(mon, 12), endMs: work(mon, 20), setupMin: 30, runMin: 450, atRisk: false, changeover: true },
          { id: '3', resourceId: 'pa', label: 'DL-1008', sourceTag: 'std', startMs: work(mon + DAY, 6), endMs: work(mon + DAY, 14), setupMin: 30, runMin: 450, atRisk: false, changeover: true },
          { id: '4', resourceId: 'pb', label: 'DL-1002', sourceTag: 'std', startMs: work(mon, 6), endMs: work(mon, 16), setupMin: 30, runMin: 570, atRisk: false, changeover: false },
          { id: '5', resourceId: 'pb', label: 'DL-1003', sourceTag: 'std', startMs: work(mon + DAY, 6), endMs: work(mon + DAY, 15), setupMin: 28, runMin: 512, atRisk: true, changeover: true },
          { id: '6', resourceId: 'pb', label: 'DL-1010', sourceTag: 'std', startMs: work(mon + 2 * DAY, 6), endMs: work(mon + 2 * DAY, 13), setupMin: 30, runMin: 390, atRisk: false, changeover: false },
        ]}
      />
    </YStack>
  ),
}
