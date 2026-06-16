import type { Meta, StoryObj } from '@storybook/react'
import { H, P } from './typography'
import { Screen } from './Screen'

const meta: Meta<typeof Screen> = {
  title: 'Layout/Screen',
  component: Screen,
}
export default meta

type Story = StoryObj<typeof Screen>

export const Default: Story = {
  render: () => (
    <Screen minHeight={320} gap="$3">
      <H level={1}>Screen</H>
      <P size={3} color="$textSecondary">
        Solid `$background` with default padding. Toggle the theme toolbar to see
        the surface switch between light and dark.
      </P>
    </Screen>
  ),
}

export const Unpadded: Story = {
  render: () => (
    <Screen minHeight={320} padded={false} gap="$3">
      <H level={3}>No padding</H>
      <P size={3} color="$textSecondary">
        `padded={false}` removes the default inset.
      </P>
    </Screen>
  ),
}
