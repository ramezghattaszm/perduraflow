import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { YStack } from 'tamagui'
import { CoverageProposal } from './CoverageProposal'

const meta: Meta<typeof CoverageProposal> = { title: 'Workforce/CoverageProposal', component: CoverageProposal }
export default meta
type Story = StoryObj<typeof CoverageProposal>

export const Proposed: Story = {
  render: () => {
    const [confirmed, setConfirmed] = useState(false)
    return (
      <YStack maxWidth={320}>
        <CoverageProposal
          heading="Re-balance proposed"
          gapText="Leak test has no certified operator next shift."
          actionText="→ Call in Jorge Morales on overtime"
          detailText="certified · within OT rules · service protected"
          confirmLabel="Approve OT call-in"
          confirmedLabel="OT call-in confirmed"
          confirmed={confirmed}
          onConfirm={() => setConfirmed(true)}
        />
      </YStack>
    )
  },
}
