import type { ComponentType } from 'react'
import type { ColorTokens } from '@perduraflow/ui'
import {
  Award,
  CalendarDays,
  Cpu,
  Factory,
  FolderKanban,
  Grid3x3,
  HardHat,
  Handshake,
  Layers,
  LayoutDashboard,
  Network,
  Package,
  ShieldCheck,
  Users,
  Workflow,
} from '@tamagui/lucide-icons'

/**
 * App shell navigation config — the single source for the sidebar sections and
 * their routes (UI §0.1). `labelKey` resolves in the `admin` i18n namespace;
 * `sectionLabelKey` is the muted group header. Admin is one configuration of the
 * generic AppShell; other areas (scheduling) supply their own.
 */
export interface NavConfigEntry {
  id: string
  labelKey: string
  path: string
  icon: ComponentType<{ size?: number; color?: ColorTokens }>
}

export interface NavConfigSection {
  id: string
  sectionLabelKey: string
  items: NavConfigEntry[]
}

export const ADMIN_NAV: NavConfigSection[] = [
  {
    id: 'administration',
    sectionLabelKey: 'nav.sections.administration',
    items: [
      { id: 'dashboard', labelKey: 'nav.dashboard', path: '/', icon: LayoutDashboard },
      { id: 'plants', labelKey: 'nav.plants', path: '/admin/plants', icon: Factory },
      { id: 'plant-groups', labelKey: 'nav.plantGroups', path: '/admin/plant-groups', icon: Network },
      { id: 'customers', labelKey: 'nav.customers', path: '/admin/customers', icon: Handshake },
      { id: 'programs', labelKey: 'nav.programs', path: '/admin/programs', icon: FolderKanban },
      { id: 'calendars', labelKey: 'nav.calendars', path: '/admin/calendars', icon: CalendarDays },
    ],
  },
  {
    id: 'master-data',
    sectionLabelKey: 'nav.sections.masterData',
    items: [
      { id: 'parts', labelKey: 'nav.parts', path: '/master-data/parts', icon: Package },
      { id: 'resources', labelKey: 'nav.resources', path: '/master-data/resources', icon: Cpu },
      { id: 'resource-groups', labelKey: 'nav.resourceGroups', path: '/master-data/resource-groups', icon: Layers },
      { id: 'routings', labelKey: 'nav.routings', path: '/master-data/routings', icon: Workflow },
      { id: 'certifications', labelKey: 'nav.certifications', path: '/master-data/certifications', icon: Award },
      { id: 'operators', labelKey: 'nav.operators', path: '/master-data/operators', icon: HardHat },
      { id: 'qualifications', labelKey: 'nav.qualifications', path: '/master-data/qualifications', icon: Grid3x3 },
    ],
  },
  {
    id: 'access',
    sectionLabelKey: 'nav.sections.access',
    items: [
      { id: 'roles', labelKey: 'nav.roles', path: '/admin/roles', icon: ShieldCheck },
      { id: 'users', labelKey: 'nav.users', path: '/admin/users', icon: Users },
    ],
  },
]
