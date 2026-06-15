import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { LearnedParamPanel } from './LearnedParamPanel'

const meta: Meta<typeof LearnedParamPanel> = { title: 'Metrics/LearnedParamPanel', component: LearnedParamPanel }
export default meta
type Story = StoryObj<typeof LearnedParamPanel>

/** Learned (ml) state — the std→learned settled step + confidence + tool-wear trigger. */
export const Learned: Story = {
  render: () => (
    <YStack maxWidth={360}>
      <LearnedParamPanel
        title="FG-1003 · Press Line A"
        subtitle="op 30 · stamping"
        metricLabel="Learned cycle time"
        sourceText="ml"
        standardText="70m"
        learned={{
          learnedText: '76m',
          deltaText: '+8%',
          confidence: 0.86,
          basisText: 'Learned from 12 actuals.',
          settledText: 'settled — holding steady',
          trigger: {
            title: 'Tool-wear signal',
            body: 'Cycle drift on Press Line A crossed threshold — flagged. Schedule re-sequenced to protect downstream.',
          },
        }}
      />
    </YStack>
  ),
}

/** Standard (std) state — standard times + an explicit "no learned adjustment yet" note. */
export const Standard: Story = {
  render: () => (
    <YStack maxWidth={360}>
      <LearnedParamPanel
        title="FG-1002 · Weld Cell 2"
        subtitle="op 20 · welding"
        metricLabel="Cycle time"
        sourceText="std"
        standardText="95m"
        secondary={{ label: 'Setup', value: '30m' }}
        standardNote="Running on standard times — not enough actuals to adopt a learned value."
      />
    </YStack>
  ),
}
