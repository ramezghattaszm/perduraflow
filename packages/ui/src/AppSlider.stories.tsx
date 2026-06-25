import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { YStack } from 'tamagui'
import { AppSlider } from './AppSlider'
import { P } from './typography'

const meta: Meta<typeof AppSlider> = { title: 'Inputs/AppSlider', component: AppSlider }
export default meta
type Story = StoryObj<typeof AppSlider>

/** Primary tone — a normal in-range value. */
export const Primary: Story = {
  render: () => {
    const [v, setV] = useState(10)
    return (
      <YStack maxWidth={360} gap="$2" padding="$4">
        <P size={3}>Value: {v}</P>
        <AppSlider value={v} onChange={setV} min={0} max={20} step={0.1} />
      </YStack>
    )
  },
}

/** Warning tone — e.g. a value that breaches a guard (firm-lateness dominance). */
export const Warning: Story = {
  render: () => {
    const [v, setV] = useState(8)
    return (
      <YStack maxWidth={360} gap="$2" padding="$4">
        <P size={3}>Value: {v} (over the ceiling)</P>
        <AppSlider value={v} onChange={setV} min={0} max={20} step={0.1} tone="warning" />
      </YStack>
    )
  },
}
