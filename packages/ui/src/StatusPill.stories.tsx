import type { Meta, StoryObj } from '@storybook/react'
import { XStack } from 'tamagui'
import { StatusPill } from './StatusPill'

const meta: Meta<typeof StatusPill> = { title: 'Data/StatusPill', component: StatusPill }
export default meta
type Story = StoryObj<typeof StatusPill>

export const AllTones: Story = {
  render: () => (
    <XStack gap="$3">
      <StatusPill tone="active">Active</StatusPill>
      <StatusPill tone="inactive">Inactive</StatusPill>
      <StatusPill tone="neutral">Cluster</StatusPill>
    </XStack>
  ),
}
