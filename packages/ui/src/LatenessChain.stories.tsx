import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { LatenessChain } from './LatenessChain'

const meta: Meta<typeof LatenessChain> = {
  title: 'Components/LatenessChain',
  component: LatenessChain,
  args: {
    title: 'Why late',
    summary: 'PV-22 material · held by ST-8830 (op 20)',
    lines: [
      'DL-2002 op 20 · Leak-Test Station — line occupied, held by',
      'ST-8830 op 20 · Leak-Test Station — waiting on its earlier op',
      'ST-8830 op 10 · Weld Cell 2 — PV-22 material',
    ],
    expandLabel: 'Show chain',
    collapseLabel: 'Hide chain',
  },
  decorators: [
    (Story) => (
      <YStack width={360} padding="$3">
        <Story />
      </YStack>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof LatenessChain>

/** The full C2×C3 cascade — material gate spilling onto the shared inspection station. */
export const Cascade: Story = {}

/** A self-rooted late order (due before it could start) — single hop, no expander. */
export const SelfRoot: Story = {
  args: {
    summary: 'due before it could start',
    lines: ['DL-1006 op 10 · Press Line A — due before it could start'],
  },
}
