import type { Meta, StoryObj } from '@storybook/react'
import { XStack } from 'tamagui'
import { OrgAvatar } from './OrgAvatar'

const meta: Meta<typeof OrgAvatar> = {
  title: 'Components/OrgAvatar',
  component: OrgAvatar,
  args: { name: 'Saltillo Industrial Group', size: 34 },
}
export default meta
type Story = StoryObj<typeof OrgAvatar>

export const Placeholder: Story = { args: { src: null } }
export const WithLogo: Story = { args: { src: 'https://avatars.githubusercontent.com/u/0?v=4' } }
export const Sizes: Story = {
  render: () => (
    <XStack gap="$3" alignItems="center">
      <OrgAvatar name="Acme" size={30} />
      <OrgAvatar name="Acme" size={34} />
      <OrgAvatar name="Acme" size={48} />
    </XStack>
  ),
}
