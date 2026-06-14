'use client'

import { type ReactNode, useState } from 'react'
import { useRouter } from 'solito/navigation'
import {
  type NavSection,
  OrgAvatar,
  P,
  Portal,
  ScrollView,
  SidebarNav,
  useMedia,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useUpdatePreferences } from '../../hooks/useMe'
import { useCurrentUser } from '../../stores/auth.store'
import { TopBar } from './top-bar'
import { ADMIN_NAV, type NavConfigSection } from './nav'

type MaxWidth = number | 'small' | 'medium' | 'large' | 'fullscreen'
const widthProps: Record<'small' | 'medium' | 'large', number> = { small: 800, medium: 1100, large: 1800 }

export interface AppShellProps {
  /** Navigation config (sections + items). Admin passes `ADMIN_NAV`. */
  nav: NavConfigSection[]
  activeId: string
  maxWidth?: MaxWidth
  children: ReactNode
}

/**
 * AppShell — the app chrome (UI shell spec): a full-height SidebarNav (brand zone,
 * sections, collapse rail, footer), a utility TopBar over the content column, and
 * the scrolling content. Responsive: at `small` the sidebar becomes an off-canvas
 * drawer opened from the TopBar menu button. Sidebar collapse is a per-user
 * preference persisted server-side (never browser storage). Admin is one `nav`
 * configuration; other areas supply their own.
 */
export function AppShell({ nav, activeId, maxWidth = 'fullscreen', children }: AppShellProps) {
  const router = useRouter()
  const { t } = useTranslation('admin')
  const user = useCurrentUser()
  const updatePreferences = useUpdatePreferences()
  const media = useMedia()
  const isSmall = Boolean(media['max-md'])
  const [navOpen, setNavOpen] = useState(false)
  const collapsed = Boolean(user?.preferences?.sidebarCollapsed)

  // Resolve nav config → SidebarNav sections (labels + navigation side effects).
  const sections: NavSection[] = nav.map((section) => ({
    id: section.id,
    label: t(section.sectionLabelKey),
    items: section.items.map((it) => ({
      id: it.id,
      label: t(it.labelKey),
      icon: it.icon,
      onPress: () => {
        router.push(it.path)
        setNavOpen(false)
      },
    })),
  }))

  // Breadcrumb = active section / active item (utility bar only — never the title).
  const activeSection = nav.find((s) => s.items.some((it) => it.id === activeId))
  const activeItem = activeSection?.items.find((it) => it.id === activeId)
  const breadcrumb =
    activeSection && activeItem ? [t(activeSection.sectionLabelKey), t(activeItem.labelKey)] : undefined

  const brandName = user?.tenantName ?? ''
  const renderBrand = (c: boolean) => (
    <BrandZone collapsed={c} name={brandName} logoUrl={user?.tenantLogoUrl} subtitle={t('shell.brandSubtitle')} />
  )
  const renderFooter = (c: boolean) => <PoweredBy collapsed={c} label={t('shell.poweredBy')} />

  const max =
    typeof maxWidth === 'number' ? maxWidth : maxWidth === 'fullscreen' ? undefined : widthProps[maxWidth]

  if (isSmall) {
    return (
      <YStack flex={1} backgroundColor="$background" style={{ minHeight: '100dvh' }}>
        <TopBar isSmall collapsed={false} onToggleCollapse={() => {}} onOpenDrawer={() => setNavOpen(true)} />
        <ScrollView flex={1}>
          <YStack flex={1} padding="$4" gap="$4" width="100%">
            {children}
          </YStack>
        </ScrollView>
        {navOpen ? (
          <Portal>
            <YStack
              position="fixed"
              top={0}
              left={0}
              right={0}
              bottom={0}
              zIndex={200000}
              backgroundColor="$overlay"
              pointerEvents="auto"
              onPress={() => setNavOpen(false)}
            >
              <YStack onPress={(e) => e.stopPropagation()} height="100%" alignSelf="flex-start">
                <SidebarNav
                  sections={sections}
                  activeId={activeId}
                  header={renderBrand}
                  footer={renderFooter}
                />
              </YStack>
            </YStack>
          </Portal>
        ) : null}
      </YStack>
    )
  }

  return (
    <XStack flex={1} backgroundColor="$background" style={{ minHeight: '100dvh' }}>
      <SidebarNav
        sections={sections}
        activeId={activeId}
        collapsed={collapsed}
        header={renderBrand}
        footer={renderFooter}
      />
      <YStack flex={1} minWidth={0}>
        <TopBar
          isSmall={false}
          collapsed={collapsed}
          onToggleCollapse={() => updatePreferences({ sidebarCollapsed: !collapsed })}
          onOpenDrawer={() => {}}
          breadcrumb={breadcrumb}
        />
        <ScrollView flex={1}>
          <YStack flex={1} padding="$6" gap="$5" maxWidth={max} width="100%" alignSelf="center">
            {children}
          </YStack>
        </ScrollView>
      </YStack>
    </XStack>
  )
}

/** Sidebar brand zone: OrgAvatar + tenant name + context line; avatar-only when collapsed. */
function BrandZone({
  collapsed,
  name,
  logoUrl,
  subtitle,
}: {
  collapsed: boolean
  name: string
  logoUrl?: string | null
  subtitle: string
}) {
  return (
    <XStack
      alignItems="center"
      gap="$3"
      paddingVertical="$2"
      paddingHorizontal={collapsed ? '$0' : '$2'}
      justifyContent={collapsed ? 'center' : 'flex-start'}
    >
      <OrgAvatar src={logoUrl} name={name} size={collapsed ? 30 : 34} />
      {collapsed ? null : (
        <YStack flex={1}>
          <P size={3} weight="b" numberOfLines={1}>
            {name}
          </P>
          <P size={7} color="$textSecondary" numberOfLines={1}>
            {subtitle}
          </P>
        </YStack>
      )}
    </XStack>
  )
}

/** Sidebar footer: subordinate PerduraFlow product mark; mark-only when collapsed. */
function PoweredBy({ collapsed, label }: { collapsed: boolean; label: string }) {
  const mark = (
    <XStack width={24} height={24} borderRadius="$3" backgroundColor="$primary" alignItems="center" justifyContent="center">
      <P size={8} weight="h" color="$surface">
        PF
      </P>
    </XStack>
  )
  return collapsed ? (
    <XStack justifyContent="center" paddingVertical="$2">
      {mark}
    </XStack>
  ) : (
    <XStack alignItems="center" gap="$2" paddingHorizontal="$2" paddingVertical="$2">
      {mark}
      <P size={7} color="$textSecondary">
        {label}
      </P>
    </XStack>
  )
}

/**
 * AdminShell — the admin-area configuration of {@link AppShell} (D34/A6). Wires
 * the admin nav; each admin screen renders inside it with its `activeId`.
 */
export function AdminShell({
  activeId,
  maxWidth = 'fullscreen',
  children,
}: {
  activeId: string
  maxWidth?: MaxWidth
  children: ReactNode
}) {
  return (
    <AppShell nav={ADMIN_NAV} activeId={activeId} maxWidth={maxWidth}>
      {children}
    </AppShell>
  )
}
