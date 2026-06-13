import type { Meta, StoryObj } from '@storybook/react'
import { XStack } from 'tamagui'
import { AppAvatar } from './AppAvatar'

const meta: Meta<typeof AppAvatar> = {
  title: 'Components/AppAvatar',
  component: AppAvatar,
  args: { name: 'Jane Doe', size: '$5' },
}
export default meta

type Story = StoryObj<typeof AppAvatar>

export const Image: Story = {
  args: { src: 'https://i.pravatar.cc/150?img=5' },
}

export const InitialsFallback: Story = {
  args: { src: null },
}

export const Sizes: Story = {
  render: () => (
    <XStack gap="$3" alignItems="center">
      <AppAvatar name="Jane Doe" size="$3" />
      <AppAvatar name="Jane Doe" size="$4" />
      <AppAvatar name="Jane Doe" size="$5" />
      <AppAvatar name="Jane Doe" size="$6" />
    </XStack>
  ),
}
