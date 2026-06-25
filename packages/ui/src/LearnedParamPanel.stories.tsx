import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { LearnedParamPanel } from './LearnedParamPanel'

const meta: Meta<typeof LearnedParamPanel> = { title: 'Metrics/LearnedParamPanel', component: LearnedParamPanel }
export default meta
type Story = StoryObj<typeof LearnedParamPanel>

/** Measured (ml_adjusted) — the op's settled std→learned step + actuals + performance. */
export const Measured: Story = {
  render: () => (
    <YStack maxWidth={400}>
      <LearnedParamPanel
        title="FG-1003 · Press Line A"
        subtitle="op 30"
        provenance="measured"
        metricLabel="Cycle time"
        sourceText="ml"
        measured={{
          standardText: '0.70m',
          learnedText: '0.76m',
          deltaText: '+8%',
          basisText: 'Learned from 12 actuals',
          settledText: 'settled — holding steady',
        }}
        performance={{
          label: 'Performance — planned vs actual',
          rows: [
            { label: 'Cycle / unit', value: '0.7 → 0.76 min', tone: 'warn' },
            { label: 'Good / scrap', value: '68 / 2', tone: 'bad' },
          ],
          emptyText: 'No actuals yet.',
        }}
        wearPointer={{ label: 'Press Line A predicted wear — see line', onPress: () => {} }}
      />
    </YStack>
  ),
}

/** Predicted (ml_predicted) — a pre-adopted forecast applied ahead of the drift: the std→predicted
 *  step in amber (forecast) vocabulary, "not yet measured — reversible". Distinct from Measured. */
export const Predicted: Story = {
  render: () => (
    <YStack maxWidth={400}>
      <LearnedParamPanel
        title="FG-1003 · Press Line A"
        subtitle="op 30"
        provenance="predicted"
        metricLabel="Pre-adopted cycle time"
        sourceText="predicted"
        predicted={{
          standardText: '0.30m',
          predictedText: '0.32m',
          deltaText: '+5%',
          basisText: 'Pre-adopted forecast',
          noteText: 'not yet measured — reversible',
        }}
        wearPointer={{ label: 'Press Line A predicted wear — see line', onPress: () => {} }}
      />
    </YStack>
  ),
}

/** Standard (std) — standard times + an explicit "no learned adjustment yet" note. */
export const Standard: Story = {
  render: () => (
    <YStack maxWidth={400}>
      <LearnedParamPanel
        title="FG-1002 · Weld Cell 2"
        subtitle="op 20"
        provenance="standard"
        metricLabel="Cycle time"
        sourceText="std"
        standardText="0.95m"
        secondary={{ label: 'Setup', value: '30m' }}
        standardNote="Running on standard times — not enough actuals to adopt a learned value."
      />
    </YStack>
  ),
}
