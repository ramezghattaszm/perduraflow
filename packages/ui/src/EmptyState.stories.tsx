import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState } from './EmptyState'

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  args: { icon: '📭', title: 'No items yet', subtitle: 'Create your first one to get started.' },
}
export default meta

type Story = StoryObj<typeof EmptyState>

export const Default: Story = {}

export const WithAction: Story = {
  args: { actionLabel: 'Create item', onAction: () => {} },
}

export const TitleOnly: Story = {
  args: { icon: undefined, subtitle: undefined, title: 'Nothing here' },
}

export const Error: Story = {
  args: {
    icon: '⚠️',
    title: 'Something went wrong',
    subtitle: 'Please try again.',
    actionLabel: 'Retry',
    onAction: () => {},
  },
}
