import type { Meta, StoryObj } from '@storybook/react'
import { XStack, YStack } from 'tamagui'
import { AppButton } from './AppButton'

const meta: Meta<typeof AppButton> = {
  title: 'Components/AppButton',
  component: AppButton,
  args: { children: 'Continue', variant: 'primary', size: '$4' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'ghost', 'danger', 'light'] },
    size: { control: 'select', options: ['$3', '$4', '$5'] },
  },
}
export default meta

type Story = StoryObj<typeof AppButton>

export const Primary: Story = {}
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Danger: Story = { args: { variant: 'danger' } }
export const Light: Story = { args: { variant: 'light' } }
export const Loading: Story = { args: { loading: true } }
export const Disabled: Story = { args: { disabled: true } }

export const AllVariants: Story = {
  render: () => (
    <YStack gap="$3">
      <XStack gap="$3" flexWrap="wrap">
        <AppButton variant="primary">Primary</AppButton>
        <AppButton variant="ghost">Ghost</AppButton>
        <AppButton variant="danger">Danger</AppButton>
        <AppButton variant="light">Light</AppButton>
      </XStack>
      <XStack gap="$3" alignItems="center" flexWrap="wrap">
        <AppButton size="$3">Small</AppButton>
        <AppButton size="$4">Medium</AppButton>
        <AppButton size="$5">Large</AppButton>
      </XStack>
    </YStack>
  ),
}
