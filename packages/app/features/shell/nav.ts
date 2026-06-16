import type { ComponentType } from 'react'
import type { ColorTokens } from '@perduraflow/ui'
import {
  Award,
  CalendarClock,
  CalendarDays,
  Cpu,
  Factory,
  FolderKanban,
  Gauge,
  Grid3x3,
  HardHat,
  Handshake,
  Layers,
  LayoutDashboard,
  ListChecks,
  Network,
  Package,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  Users,
  Workflow,
} from '@tamagui/lucide-icons'

/**
 * App shell navigation config (UI §0.1 / frontend-spec-shell Revision 2). Split by
 * frequency/role: `OPERATIONAL_NAV` is the primary sidebar (used every shift);
 * `ADMIN_NAV` is the configuration nav shown behind the gear (desktop overlay
 * panel) / Settings drill-down (phone). `labelKey` resolves in the `admin` i18n
 * namespace; `sectionLabelKey` is the muted group header.
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

/** Operational primary nav — short, stable, used every shift (Revision 2 R2.1). */
export const OPERATIONAL_NAV: NavConfigSection[] = [
  {
    id: 'operations',
    sectionLabelKey: 'nav.sections.operations',
    items: [{ id: 'dashboard', labelKey: 'nav.dashboard', path: '/', icon: LayoutDashboard }],
  },
  {
    id: 'scheduling',
    sectionLabelKey: 'nav.sections.scheduling',
    items: [
      { id: 'board', labelKey: 'nav.board', path: '/scheduling/board', icon: CalendarClock },
      { id: 'exceptions', labelKey: 'nav.exceptions', path: '/scheduling/exceptions', icon: ListChecks },
      { id: 'scorecard', labelKey: 'nav.scorecard', path: '/scorecard', icon: Gauge },
      { id: 'workforce', labelKey: 'nav.workforce', path: '/workforce', icon: UserCheck },
      { id: 'objective-policy', labelKey: 'nav.objectivePolicy', path: '/objective-policy', icon: SlidersHorizontal },
    ],
  },
]

/**
 * Admin / configuration nav (behind the gear). Grouped Configuration / Master
 * Data / Access; namespaced routes `/admin/<group>/*` (Revision 2 SR2). Editing is
 * gated by `canConfigure`; the area is view-readable to operational roles (SR1).
 */
export const ADMIN_NAV: NavConfigSection[] = [
  {
    id: 'configuration',
    sectionLabelKey: 'nav.sections.configuration',
    items: [
      { id: 'plants', labelKey: 'nav.plants', path: '/admin/config/plants', icon: Factory },
      { id: 'plant-groups', labelKey: 'nav.plantGroups', path: '/admin/config/plant-groups', icon: Network },
      { id: 'customers', labelKey: 'nav.customers', path: '/admin/config/customers', icon: Handshake },
      { id: 'programs', labelKey: 'nav.programs', path: '/admin/config/programs', icon: FolderKanban },
      { id: 'calendars', labelKey: 'nav.calendars', path: '/admin/config/calendars', icon: CalendarDays },
    ],
  },
  {
    id: 'master-data',
    sectionLabelKey: 'nav.sections.masterData',
    items: [
      { id: 'parts', labelKey: 'nav.parts', path: '/admin/master-data/parts', icon: Package },
      { id: 'resources', labelKey: 'nav.resources', path: '/admin/master-data/resources', icon: Cpu },
      { id: 'resource-groups', labelKey: 'nav.resourceGroups', path: '/admin/master-data/resource-groups', icon: Layers },
      { id: 'routings', labelKey: 'nav.routings', path: '/admin/master-data/routings', icon: Workflow },
      { id: 'certifications', labelKey: 'nav.certifications', path: '/admin/master-data/certifications', icon: Award },
      { id: 'operators', labelKey: 'nav.operators', path: '/admin/master-data/operators', icon: HardHat },
      { id: 'qualifications', labelKey: 'nav.qualifications', path: '/admin/master-data/qualifications', icon: Grid3x3 },
    ],
  },
  {
    id: 'access',
    sectionLabelKey: 'nav.sections.access',
    items: [
      { id: 'roles', labelKey: 'nav.roles', path: '/admin/access/roles', icon: ShieldCheck },
      { id: 'users', labelKey: 'nav.users', path: '/admin/access/users', icon: Users },
    ],
  },
]
