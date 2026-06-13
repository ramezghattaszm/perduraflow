import type { Meta, StoryObj } from '@storybook/react'
import { H, P } from './typography'
import { GradientScreen } from './GradientScreen'

const meta: Meta<typeof GradientScreen> = {
  title: 'Layout/GradientScreen',
  component: GradientScreen,
}
export default meta

type Story = StoryObj<typeof GradientScreen>

export const ThemeGradient: Story = {
  render: () => (
    <GradientScreen minHeight={320} padding="$5" justifyContent="center" gap="$3">
      <H level={1} color="$surface">
        Welcome
      </H>
      <P size={3} color="$surface">
        Theme-driven gradient (`$gradientStart` → `$gradientEnd`). Toggle the
        theme toolbar to see it adapt.
      </P>
    </GradientScreen>
  ),
}

export const CustomColors: Story = {
  render: () => (
    <GradientScreen
      minHeight={320}
      padding="$5"
      justifyContent="center"
      from="#FF7E5F"
      to="#FEB47B"
    >
      <H level={2} color="$surface">
        Fixed gradient
      </H>
    </GradientScreen>
  ),
}
