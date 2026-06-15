import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { LearnedParamPanel } from './LearnedParamPanel'

const meta: Meta<typeof LearnedParamPanel> = { title: 'Metrics/LearnedParamPanel', component: LearnedParamPanel }
export default meta
type Story = StoryObj<typeof LearnedParamPanel>

export const SettledStep: Story = {
  render: () => (
    <YStack maxWidth={360}>
      <LearnedParamPanel
        title="FG-1003 · Press Line A"
        subtitle="op 30 · stamping"
        metricLabel="Learned cycle time"
        standardText="70m"
        learnedText="76m"
        deltaText="+8%"
        confidence={0.86}
        basisText="Learned from 12 actuals."
        settledText="settled — holding steady"
        trigger={{
          title: 'Tool-wear signal',
          body: 'Cycle drift on Press Line A crossed threshold — flagged. Schedule re-sequenced to protect downstream.',
        }}
      />
    </YStack>
  ),
}
