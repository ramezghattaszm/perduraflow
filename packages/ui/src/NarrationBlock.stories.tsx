import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { NarrationBlock } from './NarrationBlock'

const meta: Meta<typeof NarrationBlock> = {
  title: 'WhatIf/NarrationBlock',
  component: NarrationBlock,
}
export default meta
type Story = StoryObj<typeof NarrationBlock>

const base = {
  title: 'In plain language',
  loadingText: 'Writing the explanation…',
  unavailableText: 'Explanation unavailable — the options and rationale above are the answer.',
}

/** Prose ready (translate-only; rendered alongside the rationale). */
export const Ready: Story = {
  render: () => (
    <YStack
      maxWidth={420}
      padding="$3"
    >
      <NarrationBlock
        {...base}
        state="ready"
        prose="Re-sequence (balanced) leaves 1 late order at cost/unit $3.86 and is preferred over Protect delivery, driven by displacement."
      />
    </YStack>
  ),
}

/** Writing (async, non-blocking). */
export const Loading: Story = {
  render: () => (
    <YStack
      maxWidth={420}
      padding="$3"
    >
      <NarrationBlock
        {...base}
        state="loading"
      />
    </YStack>
  ),
}

/** Model slow/failed — honest, zero functional impact. */
export const Unavailable: Story = {
  render: () => (
    <YStack
      maxWidth={420}
      padding="$3"
    >
      <NarrationBlock
        {...base}
        state="unavailable"
      />
    </YStack>
  ),
}
