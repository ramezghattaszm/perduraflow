import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { H, P } from './typography'

const meta: Meta = {
  title: 'Foundations/Typography',
}
export default meta

type Story = StoryObj

export const Headings: Story = {
  render: () => (
    <YStack gap="$2">
      <H level={0}>Display (level 0)</H>
      <H level={1}>Heading 1</H>
      <H level={2}>Heading 2</H>
      <H level={3}>Heading 3</H>
      <H level={4}>Heading 4</H>
      <H level={5}>Heading 5</H>
      <H level={6}>Heading 6</H>
    </YStack>
  ),
}

export const Body: Story = {
  render: () => (
    <YStack gap="$2">
      <P size={1}>Body 1 — the quick brown fox jumps over the lazy dog.</P>
      <P size={2}>Body 2 — the quick brown fox jumps over the lazy dog.</P>
      <P size={3}>Body 3 — the quick brown fox jumps over the lazy dog.</P>
      <P size={4}>Body 4 — the quick brown fox jumps over the lazy dog.</P>
      <P size={5} color="$textSecondary">
        Body 5 secondary — captions and helper text.
      </P>
      <P size={6} color="$textSecondary">
        Body 6 secondary — fine print.
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
