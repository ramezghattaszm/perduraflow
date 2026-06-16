import type { Meta, StoryObj } from '@storybook/react'
import { Factory } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { AppTooltip } from './Tooltip'
import { P } from './typography'

const meta: Meta<typeof AppTooltip> = { title: 'Components/AppTooltip', component: AppTooltip }
export default meta
type Story = StoryObj<typeof AppTooltip>

export const RailIcon: Story = {
  render: () => (
    <YStack padding="$8" alignItems="flex-start">
      <AppTooltip label="Plants">
        <XStack width={44} height={44} borderRadius="$4" alignItems="center" justifyContent="center" backgroundColor="$primarySoft">
          <Factory size={20} color="$primary" />
        </XStack>
      </AppTooltip>
    </YStack>
  ),
}

export const Top: Story = {
  render: () => (
    <YStack padding="$10" alignItems="center">
      <AppTooltip label="Above the trigger" placement="top">
        <P size={3}>Hover me</P>
      </AppTooltip>
    </YStack>
  ),
}
