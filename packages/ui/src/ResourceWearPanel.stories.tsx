import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { ResourceWearPanel } from './ResourceWearPanel'

const meta: Meta<typeof ResourceWearPanel> = { title: 'Metrics/ResourceWearPanel', component: ResourceWearPanel }
export default meta
type Story = StoryObj<typeof ResourceWearPanel>

/** A line with a wear warning + forecast — proximity track (bar) + confidence (ring) + consequence. */
export const Wearing: Story = {
  render: () => (
    <YStack maxWidth={420}>
      <ResourceWearPanel
        title="Press Line A"
        subtitle="Tool wear & forecast"
        status={{ label: 'Wear', tone: 'warning' }}
        warning={{
          title: 'Tool-wear signal',
          body: 'Cycle drift on Press Line A crossed threshold — flagged. Schedule re-sequenced to protect downstream.',
        }}
        prediction={{
          statement: 'Predicted to cross the wear line in 3.8h (~05:31)',
          proximity: { valueFrac: 0.5, notchFrac: 0.5, caption: 'std → +5% wear line' },
          confidence: 0.82,
          confidenceLabel: 'Confidence',
          basisText: 'Forecast from the trend over 9 actuals — not yet measured',
        }}
        consequence={{
          maintenance: 'Maintenance recommended',
          downstream: 'Downstream: 3 op(s) on Press Line A — kept fed by the pre-emptive adjustment',
        }}
      />
    </YStack>
  ),
}

/** A healthy line — no wear signal. */
export const Healthy: Story = {
  render: () => (
    <YStack maxWidth={420}>
      <ResourceWearPanel title="Press Line B" subtitle="Tool wear & forecast" emptyText="No wear signal — running on standard." />
    </YStack>
  ),
}
