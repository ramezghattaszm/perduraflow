import type { Meta, StoryObj } from '@storybook/react'
import { AppButton } from './AppButton'
import { PageHeader } from './PageHeader'

const meta: Meta<typeof PageHeader> = { title: 'Layout/PageHeader', component: PageHeader }
export default meta
type Story = StoryObj<typeof PageHeader>

export const WithAction: Story = {
  args: {
    title: 'Plants',
    subtitle: 'Producing sites in this tenant.',
    actions: <AppButton size="$3">New plant</AppButton>,
  },
}

export const TitleOnly: Story = { args: { title: 'Dashboard' } }
