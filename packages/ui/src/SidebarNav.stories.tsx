import type { Meta, StoryObj } from '@storybook/react'
import { H } from './typography'
import { SidebarNav } from './SidebarNav'

const meta: Meta<typeof SidebarNav> = { title: 'Navigation/SidebarNav', component: SidebarNav }
export default meta
type Story = StoryObj<typeof SidebarNav>

export const Default: Story = {
  args: {
    activeId: 'plants',
    sectionLabel: 'Administration',
    header: <H level={4} color="$primary">PerduraFlow</H>,
    items: [
      { id: 'dashboard', label: 'Dashboard', onPress: () => {} },
      { id: 'plants', label: 'Plants', onPress: () => {} },
      { id: 'customers', label: 'Customers', onPress: () => {} },
      { id: 'roles', label: 'Roles', onPress: () => {} },
    ],
  },
}
