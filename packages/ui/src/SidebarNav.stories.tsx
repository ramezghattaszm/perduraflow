import type { Meta, StoryObj } from '@storybook/react'
import { Factory, LayoutDashboard, ShieldCheck, Users } from '@tamagui/lucide-icons'
import { OrgAvatar } from './OrgAvatar'
import { P } from './typography'
import { SidebarNav } from './SidebarNav'

const meta: Meta<typeof SidebarNav> = { title: 'Navigation/SidebarNav', component: SidebarNav }
export default meta
type Story = StoryObj<typeof SidebarNav>

const sections = [
  {
    id: 'administration',
    label: 'Administration',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, onPress: () => {} },
      { id: 'plants', label: 'Plants', icon: Factory, onPress: () => {} },
    ],
  },
  {
    id: 'access',
    label: 'Access',
    items: [
      { id: 'roles', label: 'Roles', icon: ShieldCheck, onPress: () => {} },
      { id: 'users', label: 'Users', icon: Users, onPress: () => {} },
    ],
  },
]

const header = (collapsed: boolean) => (
  <OrgAvatar name="Saltillo Industrial Group" size={collapsed ? 30 : 34} />
)
const footer = (collapsed: boolean) =>
  collapsed ? null : <P size={5} color="$textSecondary">Powered by PerduraFlow</P>

export const Expanded: Story = { args: { activeId: 'plants', sections, header, footer } }
export const Collapsed: Story = { args: { activeId: 'plants', collapsed: true, sections, header, footer } }
