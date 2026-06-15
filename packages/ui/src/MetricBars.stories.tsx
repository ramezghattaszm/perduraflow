import type { Meta, StoryObj } from '@storybook/react'
import { MetricBars } from './MetricBars'

const meta: Meta<typeof MetricBars> = { title: 'Metrics/MetricBars', component: MetricBars }
export default meta
type Story = StoryObj<typeof MetricBars>

export const Oee: Story = {
  render: () => (
    <MetricBars
      items={[
        { label: 'Availability', value: 0.88 },
        { label: 'Performance', value: 0.92 },
        { label: 'Quality', value: 0.96 },
      ]}
    />
  ),
}
