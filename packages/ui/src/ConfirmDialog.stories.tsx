import type { Meta, StoryObj } from '@storybook/react'
import { ConfirmDialog } from './ConfirmDialog'

const meta: Meta<typeof ConfirmDialog> = { title: 'Feedback/ConfirmDialog', component: ConfirmDialog }
export default meta
type Story = StoryObj<typeof ConfirmDialog>

export const Danger: Story = {
  args: {
    open: true,
    title: 'Deactivate plant?',
    message: 'It will be hidden from new scheduling but kept for history.',
    tone: 'danger',
    confirmLabel: 'Deactivate',
    onConfirm: () => {},
    onCancel: () => {},
  },
}
