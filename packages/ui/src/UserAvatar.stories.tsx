import type { Meta, StoryObj } from '@storybook/react'
import { XStack } from 'tamagui'
import { UserAvatar } from './UserAvatar'

const meta: Meta<typeof UserAvatar> = {
  title: 'Components/UserAvatar',
  component: UserAvatar,
  args: { name: 'Jane Doe', id: 'user_1', size: 32 },
}
export default meta
type Story = StoryObj<typeof UserAvatar>

export const Initials: Story = { args: { src: null } }
export const Image: Story = { args: { src: 'https://i.pravatar.cc/150?img=12' } }
export const DeterministicColors: Story = {
  render: () => (
    <XStack gap="$3" alignItems="center">
      {['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Linus T', 'Margaret H'].map((name, i) => (
        <UserAvatar key={name} id={`user_${i}`} name={name} size={38} />
      ))}
    </XStack>
  ),
}
