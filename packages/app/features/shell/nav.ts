/**
 * Admin shell navigation config — the single source for the sidebar entries and
 * their routes (UI §0.1). `labelKey` resolves in the `admin` i18n namespace.
 */
export interface NavConfigEntry {
  id: string
  labelKey: string
  path: string
}

export const ADMIN_NAV: NavConfigEntry[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', path: '/' },
  { id: 'plants', labelKey: 'nav.plants', path: '/admin/plants' },
  { id: 'plant-groups', labelKey: 'nav.plantGroups', path: '/admin/plant-groups' },
  { id: 'customers', labelKey: 'nav.customers', path: '/admin/customers' },
  { id: 'programs', labelKey: 'nav.programs', path: '/admin/programs' },
  { id: 'calendars', labelKey: 'nav.calendars', path: '/admin/calendars' },
  { id: 'roles', labelKey: 'nav.roles', path: '/admin/roles' },
  { id: 'users', labelKey: 'nav.users', path: '/admin/users' },
]
