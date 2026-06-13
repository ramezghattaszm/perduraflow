import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { YStack } from 'tamagui'
import { AppInput, type AppInputProps } from './AppInput'

const meta: Meta<typeof AppInput> = {
  title: 'Components/AppInput',
  component: AppInput,
}
export default meta

type Story = StoryObj<typeof AppInput>

function Controlled(props: AppInputProps) {
  const [value, setValue] = useState('')
  return <AppInput value={value} onChangeText={setValue} {...props} />
}

export const Text: Story = {
  render: () => <Controlled label="Full name" placeholder="Jane Doe" />,
}

export const Email: Story = {
  render: () => <Controlled type="email" label="Email" placeholder="you@example.com" />,
}

export const Password: Story = {
  render: () => <Controlled type="password" label="Password" placeholder="••••••••" />,
}

export const Multiline: Story = {
  render: () => <Controlled type="multiline" label="Bio" placeholder="Tell us about yourself" />,
}

export const WithError: Story = {
  render: () => (
    <Controlled type="email" label="Email" placeholder="you@example.com" error="Enter a valid email" />
  ),
}

export const Variants: Story = {
  render: () => (
    <YStack gap="$4">
      <Controlled variant="default" label="Default" placeholder="Default variant" />
      <Controlled variant="filled" label="Filled" placeholder="Filled variant" />
      <Controlled variant="ghost" label="Ghost" placeholder="Ghost variant" />
    </YStack>
  ),
}
