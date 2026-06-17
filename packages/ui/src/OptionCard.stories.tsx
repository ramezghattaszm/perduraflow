import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { NarrationBlock } from './NarrationBlock'
import { OptionCard } from './OptionCard'
import { RationaleView } from './RationaleView'

const meta: Meta<typeof OptionCard> = { title: 'WhatIf/OptionCard', component: OptionCard }
export default meta
type Story = StoryObj<typeof OptionCard>

const rationale = (
  <RationaleView
    factorsTitle="What drives it"
    constraintsTitle="Constraints"
    comparativesTitle="Versus the others"
    factors={[
      { label: 'Firm lateness', detail: '6h firm-order lateness across 2 order(s)', contribution: 60, direction: 'worsens' },
      { label: 'Changeovers', detail: '3 changeover(s)', contribution: 3, direction: 'worsens' },
      { label: 'Displacement', detail: '4 operation(s) moved', contribution: 8, direction: 'worsens' },
    ]}
    constraints={[
      { label: 'Firm delivery', detail: 'Firm delivery met', binding: false, type: 'soft' },
      { label: 'Feasibility', detail: 'All 14 operations placed', binding: false, type: 'hard' },
    ]}
    comparatives={[{ text: 'Re-sequence (balanced) is preferred over Protect delivery (driven by displacement).' }]}
  />
)

/** The recommended, expanded option — KPIs + rationale + narration + Apply. */
export const Recommended: Story = {
  render: () => (
    <YStack maxWidth={460} padding="$3">
      <OptionCard
        rank="#1"
        label="Re-sequence (balanced)"
        recommended
        recommendedLabel="Recommended"
        feasible
        scoreLabel="Score"
        score={31.1}
        kpis={[
          { label: 'OTIF', value: '83%', delta: '+2%', tone: 'up' },
          { label: 'Cost/unit', value: '$3.86', delta: '−$0.04', tone: 'up' },
          { label: 'Late orders', value: '1', delta: '−1', tone: 'up' },
        ]}
        expanded
        rationale={rationale}
        narration={
          <NarrationBlock
            state="ready"
            title="In plain language"
            loadingText=""
            unavailableText=""
            note="Generated from the structured rationale (translation only)."
            prose="Re-sequence (balanced) leaves 1 late order at cost/unit $3.86, and is preferred over Protect delivery, driven by displacement."
          />
        }
        applyCta="Apply this option"
        appliedLabel="Applied — review the draft"
        onApply={() => {}}
      />
    </YStack>
  ),
}

/** An infeasible option — reported honestly with a reason, collapsed. */
export const Infeasible: Story = {
  render: () => (
    <YStack maxWidth={460} padding="$3">
      <OptionCard
        rank="#3"
        label="Service now"
        recommendedLabel="Recommended"
        feasible={false}
        infeasibleReason="No eligible resource once the line is offline"
        scoreLabel="Score"
        score={0}
        kpis={[]}
        applyCta="Apply this option"
        appliedLabel="Applied"
      />
    </YStack>
  ),
}
