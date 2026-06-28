'use client'

import { type ReactNode, useState } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'
import { useRouter } from 'solito/navigation'
import { Settings } from '@tamagui/lucide-icons'
import {
  type NavSection,
  OrgAvatar,
  P,
  ScrollView,
  SidebarNav,
  useMedia,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useSafeArea } from '../../provider/safe-area/use-safe-area'
import { useUpdatePreferences } from '../../hooks/useMe'
import { useCurrentUser } from '../../stores/auth.store'
import { TopBar } from './top-bar'
import { ADMIN_NAV, OPERATIONAL_NAV, type NavConfigSection } from './nav'

type MaxWidth = number | 'small' | 'medium' | 'large' | 'fullscreen'
const widthProps: Record<'small' | 'medium' | 'large', number> = { small: 800, medium: 1100, large: 1800 }
// Web fills the viewport with 100dvh; native fills its Stack screen via 100%.
const FULL_HEIGHT = Platform.OS === 'web' ? '100dvh' : '100%'
/** Bottom clearance so a page's last row (e.g. the work-list pager) scrolls clear of the fixed
 *  Copilot launcher (circular `$5` at `bottom: 24` → ~72px tall) sitting at the viewport corner. */
const COPILOT_CLEARANCE = 96

export interface AppShellProps {
  activeId: string
  maxWidth?: MaxWidth
  /** Screen title shown in the TopBar on `small` (the in-body H1 is dropped there).
   *  Defaults to the active nav item's label (PHASE-3-POLISH item 1). */
  title?: string
  children: ReactNode
}

/**
 * AppShell — the app chrome (frontend-spec-shell Revision 2). One responsive
 * implementation across web + native: the **operational** sidebar is always
 * primary; the **admin/config** nav lives behind a gear — a slide-over overlay
 * panel on desktop/iPad, and the off-canvas drawer's "Settings" entry → the
 * `/admin` settings stack on phone. Renders natively (Expo) with safe-area insets
 * (TopBar below the notch, drawers clear the home indicator). Collapse is a
 * per-user server-side preference. `AdminShell` is the alias every screen uses.
 */
export function AppShell({ activeId, maxWidth = 'fullscreen', title, children }: AppShellProps) {
  const router = useRouter()
  const { t } = useTranslation('admin')
  const user = useCurrentUser()
  const updatePreferences = useUpdatePreferences()
  const media = useMedia()
  const insets = useSafeArea()
  const isSmall = Boolean(media['max-md'])
  const [navOpen, setNavOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const collapsed = Boolean(user?.preferences?.sidebarCollapsed)

  const build = (nav: NavConfigSection[], onAfter: () => void): NavSection[] =>
    nav.map((section) => ({
      id: section.id,
      label: t(section.sectionLabelKey),
      items: section.items.map((it) => ({
        id: it.id,
        label: t(it.labelKey),
        icon: it.icon,
        onPress: () => {
          router.push(it.path)
          onAfter()
        },
      })),
    }))

  const opSections = build(OPERATIONAL_NAV, () => setNavOpen(false))
  const adminSections = build(ADMIN_NAV, () => setAdminOpen(false))

  // Breadcrumb = active section / item, searched across both navs (utility bar only).
  const allNav = [...OPERATIONAL_NAV, ...ADMIN_NAV]
  const activeSection = allNav.find((s) => s.items.some((it) => it.id === activeId))
  const activeItem = activeSection?.items.find((it) => it.id === activeId)
  const breadcrumb =
    activeSection && activeItem ? [t(activeSection.sectionLabelKey), t(activeItem.labelKey)] : undefined
  // Small-screen TopBar title: explicit `title` else the active nav item's label.
  const topTitle = title ?? (activeItem ? t(activeItem.labelKey) : undefined)

  const brandName = user?.tenantName ?? ''
  const renderBrand = (c: boolean) => (
    <BrandZone collapsed={c} name={brandName} logoUrl={user?.tenantLogoUrl} subtitle={t('shell.brandSubtitle')} />
  )
  const renderFooter = (c: boolean) => <PoweredBy collapsed={c} label={t('shell.poweredBy')} />
  // Phone drawer footer adds the Settings/Administration entry (RBAC: visible to all — SR1).
  const renderDrawerFooter = (c: boolean) => (
    <YStack gap="$1">
      <SettingsRow
        label={t('shell.settings')}
        onPress={() => {
          setNavOpen(false)
          router.push('/admin')
        }}
      />
      <PoweredBy collapsed={c} label={t('shell.poweredBy')} />
    </YStack>
  )

  const max =
    typeof maxWidth === 'number' ? maxWidth : maxWidth === 'fullscreen' ? undefined : widthProps[maxWidth]

  return (
    <YStack flex={1} backgroundColor="$background" position="relative" style={{ height: FULL_HEIGHT, overflow: 'hidden' }}>
      {isSmall ? (
        <>
          <TopBar isSmall collapsed={false} insetTop={insets.top} title={topTitle} onToggleCollapse={() => {}} onOpenDrawer={() => setNavOpen(true)} />
          {/* Lift the page above the on-screen keyboard so focused inputs near the
              bottom stay reachable (native; no-op on web). */}
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView flex={1} keyboardShouldPersistTaps="handled">
              {/* flexGrow (not flex:1) — fills the viewport when short, but GROWS + scrolls
                  when content is taller; flex:1's flexShrink clamps to the viewport and
                  clips overflow (BAR-PANEL-FIX §5). */}
              <YStack flexGrow={1} padding="$4" gap="$4" width="100%" paddingBottom={insets.bottom + COPILOT_CLEARANCE}>
                {children}
              </YStack>
            </ScrollView>
          </KeyboardAvoidingView>
        </>
      ) : (
        <XStack flex={1}>
          <SidebarNav sections={opSections} activeId={activeId} collapsed={collapsed} header={renderBrand} footer={renderFooter} />
          <YStack flex={1} minWidth={0}>
            <TopBar
              isSmall={false}
              collapsed={collapsed}
              insetTop={insets.top}
              onToggleCollapse={() => updatePreferences({ sidebarCollapsed: !collapsed })}
              onOpenDrawer={() => {}}
              onOpenAdmin={() => setAdminOpen(true)}
              breadcrumb={breadcrumb}
            />
            <ScrollView flex={1}>
              <YStack flexGrow={1} padding="$6" gap="$5" maxWidth={max} width="100%" alignSelf="center" paddingBottom={insets.bottom + COPILOT_CLEARANCE}>
                {children}
              </YStack>
            </ScrollView>
          </YStack>
        </XStack>
      )}

      {/* Phone operational drawer (off-canvas left) — absolute so it works web + native */}
      {navOpen ? (
        <Overlay onClose={() => setNavOpen(false)} align="flex-start" insets={insets}>
          <SidebarNav sections={opSections} activeId={activeId} header={renderBrand} footer={renderDrawerFooter} fill />
        </Overlay>
      ) : null}

      {/* Desktop/iPad admin nav (gear → slide-over panel from the right) */}
      {adminOpen ? (
        <Overlay onClose={() => setAdminOpen(false)} align="flex-end" insets={insets}>
          <SidebarNav
            sections={adminSections}
            activeId={activeId}
            fill
            header={() => (
              <XStack alignItems="center" gap="$2" paddingHorizontal="$2" paddingVertical="$2">
                <Settings size={20} color="$primary" />
                <P size={3} weight="b">
                  {t('shell.administration')}
                </P>
              </XStack>
            )}
          />
        </Overlay>
      ) : null}
    </YStack>
  )
}

/** Full-screen scrim + an edge-aligned panel; cross-platform (absolute, not fixed). */
function Overlay({
  onClose,
  align,
  insets,
  children,
}: {
  onClose: () => void
  align: 'flex-start' | 'flex-end'
  insets: { top: number; bottom: number }
  children: ReactNode
}) {
  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={200000}
      backgroundColor="$overlay"
      pointerEvents="auto"
      onPress={onClose}
    >
      <YStack
        onPress={(e) => e.stopPropagation()}
        height="100%"
        alignSelf={align}
        paddingTop={insets.top}
        paddingBottom={insets.bottom}
      >
        {children}
      </YStack>
    </YStack>
  )
}

/** A "Settings / Administration" row for the phone drawer foot (RBAC: visible to all). */
function SettingsRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <XStack
      onPress={onPress}
      alignItems="center"
      gap="$3"
      height={44}
      paddingHorizontal="$3"
      borderRadius="$4"
      cursor="pointer"
      hoverStyle={{ backgroundColor: '$hoverFill' }}
      role="button"
      aria-label={label}
    >
      <Settings size={20} color="$textSecondary" />
      <P size={3} weight="m" color="$textPrimary">
        {label}
      </P>
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
          <P size={5} color="$textSecondary" numberOfLines={1}>
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
      <P size={5} weight="h" color="$surface">
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
      <P size={5} color="$textSecondary">
        {label}
      </P>
    </XStack>
  )
}

/**
 * AdminShell — alias kept so every screen keeps importing one shell. Renders the
 * one {@link AppShell}; the operational/admin split is internal (Revision 2).
 */
export function AdminShell({
  activeId,
  maxWidth = 'fullscreen',
  title,
  children,
}: {
  activeId: string
  maxWidth?: MaxWidth
  title?: string
  children: ReactNode
}) {
  return (
    <AppShell activeId={activeId} maxWidth={maxWidth} title={title}>
      {children}
    </AppShell>
  )
}
