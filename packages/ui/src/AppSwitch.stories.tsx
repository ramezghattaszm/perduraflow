import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { XStack, YStack } from 'tamagui'
import { AppSwitch } from './AppSwitch'

const meta: Meta<typeof AppSwitch> = {
  title: 'Components/AppSwitch',
  component: AppSwitch,
}
export default meta

type Story = StoryObj<typeof AppSwitch>

function Controlled({ initial = false, ...props }: { initial?: boolean; disabled?: boolean; size?: '$3' | '$4' }) {
  const [checked, setChecked] = useState(initial)
  return <AppSwitch checked={checked} onCheckedChange={setChecked} {...props} />
}

export const Off: Story = { render: () => <Controlled initial={false} /> }
export const On: Story = { render: () => <Controlled initial /> }
export const Disabled: Story = { render: () => <Controlled initial disabled /> }

export const Sizes: Story = {
  render: () => (
    <XStack gap="$4" alignItems="center">
      <Controlled initial size="$3" />
      <Controlled initial size="$4" />
    </XStack>
  ),
}

export const States: Story = {
  render: () => (
    <YStack gap="$3">
      <Controlled initial={false} />
      <Controlled initial />
      <Controlled initial disabled />
    </YStack>
  ),
}
