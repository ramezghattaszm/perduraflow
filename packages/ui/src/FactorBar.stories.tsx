import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { FactorBar } from './FactorBar'

const meta: Meta<typeof FactorBar> = { title: 'WhatIf/FactorBar', component: FactorBar }
export default meta
type Story = StoryObj<typeof FactorBar>

/** A single objective factor's weighted contribution as a magnitude bar. */
export const Default: Story = {
  render: () => (
    <YStack maxWidth={380} padding="$3" gap="$3">
      <FactorBar label="Committed lateness" detail="6h committed-order lateness across 2 order(s)" contribution={60} direction="worsens" max={60} />
      <FactorBar label="Changeovers" detail="3 changeover(s)" contribution={3} direction="worsens" max={60} />
      <FactorBar label="Displacement" detail="No operations moved" contribution={0} direction="neutral" max={60} />
    </YStack>
  ),
}
