import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { H, P } from './typography'

const meta: Meta = {
  title: 'Foundations/Typography',
}
export default meta

type Story = StoryObj

// One responsive scale (UI §4): display/1/2/3 shrink on `max-md`; 4 converges.
export const Headings: Story = {
  render: () => (
    <YStack gap="$2">
      <H level="display">Display — 48 / 32 small (hero)</H>
      <H level={1}>Heading 1 — 36 / 28 small (page title)</H>
      <H level={2}>Heading 2 — 28 / 22 small (section)</H>
      <H level={3}>Heading 3 — 22 / 20 small (sub-section)</H>
      <H level={4}>Heading 4 — 18 both (small heading)</H>
    </YStack>
  ),
}

// Body — 5 sizes, identical web + mobile. 2 (16) is the default; 5 (11) the floor.
export const Body: Story = {
  render: () => (
    <YStack gap="$2">
      <P size={1}>Body 1 (18, lead) — the quick brown fox jumps over the lazy dog.</P>
      <P size={2}>Body 2 (16, default) — the quick brown fox jumps over the lazy dog.</P>
      <P size={3} color="$textSecondary">
        Body 3 (14, secondary) — supporting text.
      </P>
      <P size={4} color="$textSecondary">
        Body 4 (12, caption) — captions and meta.
      </P>
      <P size={5} color="$textSecondary">
        Body 5 (11, micro) — dense labels / badges. The floor.
      </P>
    </YStack>
  ),
}

export const Weights: Story = {
  render: () => (
    <YStack gap="$2">
      <P size={2} weight="r">
        Regular (400)
      </P>
      <P size={2} weight="m">
        Medium (500)
      </P>
      <P size={2} weight="b">
        Semibold (600)
      </P>
      <P size={2} weight="h">
        Bold (700)
      </P>
      <P size={2} weight="b" color="$primary">
        Emphasis in $primary
      </P>
    </YStack>
  ),
}
