import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { RationaleView } from './RationaleView'

const meta: Meta<typeof RationaleView> = { title: 'WhatIf/RationaleView', component: RationaleView }
export default meta
type Story = StoryObj<typeof RationaleView>

/** The structured rationale — factors (bars), constraints, comparatives. */
export const Default: Story = {
  render: () => (
    <YStack maxWidth={440} padding="$3">
      <RationaleView
        factorsTitle="What drives it"
        constraintsTitle="Constraints"
        comparativesTitle="Versus the others"
        factors={[
          { label: 'Firm lateness', detail: '6h firm-order lateness across 2 order(s)', contribution: 60, direction: 'worsens' },
          { label: 'Changeovers', detail: '3 changeover(s)', contribution: 3, direction: 'worsens' },
          { label: 'Displacement', detail: '4 operation(s) moved from the current plan', contribution: 8, direction: 'worsens' },
        ]}
        constraints={[
          { label: 'Firm delivery', detail: 'Firm delivery breached by 6h', binding: true, type: 'soft' },
          { label: 'Feasibility', detail: 'All 14 operations placed', binding: false, type: 'hard' },
        ]}
        comparatives={[
          { text: 'Protect delivery trades off with Re-sequence (balanced) — driven by displacement.' },
          { text: 'Protect delivery is preferred over Minimise changeovers — driven by lateness.' },
        ]}
      />
    </YStack>
  ),
}
