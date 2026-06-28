import type { Meta, StoryObj } from '@storybook/react'
import { XStack, YStack } from 'tamagui'
import { P } from './typography'
import { PerduraMark } from './PerduraMark'

const meta: Meta<typeof PerduraMark> = { title: 'Brand/PerduraMark', component: PerduraMark }
export default meta
type Story = StoryObj<typeof PerduraMark>

/** The fixed brand monogram at a few sizes. Theme-independent (a logo, not UI chrome) — it reads the
 *  same in light and dark, matching the favicon / app icon. */
export const Sizes: Story = {
  render: () => (
    <YStack padding="$4" gap="$3">
      <XStack gap="$4" alignItems="center">
        <PerduraMark size={16} />
        <PerduraMark size={24} />
        <PerduraMark size={40} />
        <PerduraMark size={64} />
      </XStack>
      <P size={5} color="$textSecondary">
        24px is the sidebar “Powered by Perdura” footer mark.
      </P>
    </YStack>
  ),
}
