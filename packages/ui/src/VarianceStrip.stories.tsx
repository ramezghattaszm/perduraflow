import type { Meta, StoryObj } from '@storybook/react'
import { VarianceStrip } from './VarianceStrip'

const meta: Meta<typeof VarianceStrip> = { title: 'Metrics/VarianceStrip', component: VarianceStrip }
export default meta
type Story = StoryObj<typeof VarianceStrip>

export const Board: Story = {
  render: () => (
    <VarianceStrip
      chips={[
        { label: 'Press Line A', value: '6% behind plan', tone: 'bad' },
        { label: 'Throughput attainment', value: '94%', tone: 'ok' },
        { label: 'Schedule churn', value: 'low', tone: 'warn' },
        { label: 'Learned params', value: '7 of 11 ops', tone: 'ok' },
      ]}
    />
  ),
}
