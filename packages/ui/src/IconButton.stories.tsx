import type { Meta, StoryObj } from '@storybook/react'
import { Bell, Menu, PanelLeft, Search } from '@tamagui/lucide-icons'
import { XStack } from 'tamagui'
import { IconButton } from './IconButton'

const meta: Meta<typeof IconButton> = {
  title: 'Components/IconButton',
  component: IconButton,
  args: { icon: Menu, label: 'Open menu' },
}
export default meta
type Story = StoryObj<typeof IconButton>

export const Default: Story = {}
export const Active: Story = { args: { icon: PanelLeft, label: 'Collapse', active: true } }
export const Row: Story = {
  render: () => (
    <XStack gap="$2">
      <IconButton icon={Menu} label="Menu" />
      <IconButton icon={Search} label="Search" />
      <IconButton icon={Bell} label="Notifications" />
      <IconButton icon={PanelLeft} label="Collapse" active />
    </XStack>
  ),
}
