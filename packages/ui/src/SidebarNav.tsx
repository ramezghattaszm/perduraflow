import type { ComponentType, ReactNode } from 'react'
import { type ColorTokens, XStack, YStack } from 'tamagui'
import { AppTooltip } from './Tooltip'
import { P } from './typography'

/**
 * SidebarNav — the app shell navigation (UI shell spec §6). Full-height `$navBar`
 * rail with a brand zone (header), labelled sections of icon+label items, and a
 * footer. Items highlight by `activeId` with a `$primarySoft` fill, `$primary`
 * icon/text and a 3px left accent bar. Collapses to a 74px icon rail: labels and
 * slot text hide, icons center, and each item shows a hover Tooltip. `header` /
 * `footer` are render props receiving `collapsed` so the caller can swap the
 * tenant brand for an avatar-only mark.
 *
 * @example
 * <SidebarNav sections={sections} activeId="plants" collapsed={collapsed}
 *   header={(c) => <Brand collapsed={c} />} footer={(c) => <PoweredBy collapsed={c} />} />
 */
export interface NavEntry {
  id: string
  label: string
  icon: ComponentType<{ size?: number; color?: ColorTokens }>
  onPress: () => void
}

export interface NavSection {
  id: string
  /** Muted uppercase group label; omit for an unlabelled group. */
  label?: string
  items: NavEntry[]
}

const EXPANDED_WIDTH = 248
const COLLAPSED_WIDTH = 74

/** A single nav row. Active = `$primarySoft` fill, `$primary` icon/text, 3px left accent bar. */
export function NavItem({
  label,
  icon: Icon,
  active,
  collapsed,
  onPress,
}: {
  label: string
  icon: ComponentType<{ size?: number; color?: ColorTokens }>
  active: boolean
  collapsed?: boolean
  onPress: () => void
}) {
  const row = (
    <XStack
      onPress={onPress}
      position="relative"
      alignItems="center"
      justifyContent={collapsed ? 'center' : 'flex-start'}
      gap="$3"
      height={44}
      paddingHorizontal={collapsed ? '$0' : '$3'}
      borderRadius="$4"
      cursor="pointer"
      backgroundColor={active ? '$primarySoft' : 'transparent'}
      hoverStyle={{ backgroundColor: active ? '$primarySoft' : '$hoverFill' }}
      role="button"
      aria-label={label}
    >
      {active ? (
        <YStack
          position="absolute"
          left={collapsed ? 0 : 4}
          top={10}
          bottom={10}
          width={3}
          borderRadius={2}
          backgroundColor="$primary"
        />
      ) : null}
      <Icon size={20} color={active ? '$primary' : '$textSecondary'} />
      {collapsed ? null : (
        <P size={3} weight={active ? 'b' : 'm'} color={active ? '$primary' : '$textPrimary'}>
          {label}
        </P>
      )}
    </XStack>
  )
  return collapsed ? <AppTooltip label={label}>{row}</AppTooltip> : row
}

/** Vertical sidebar navigation with sections + collapse. */
export function SidebarNav({
  sections,
  activeId,
  collapsed,
  header,
  footer,
  fill,
}: {
  sections: NavSection[]
  activeId?: string
  collapsed?: boolean
  header?: (collapsed: boolean) => ReactNode
  footer?: (collapsed: boolean) => ReactNode
  /** Fill the parent's height (`flex: 1`). Use inside an off-canvas drawer/overlay
   *  column, where there's no `100dvh` viewport to stretch against on native. */
  fill?: boolean
}) {
  return (
    <YStack
      width={collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH}
      flex={fill ? 1 : undefined}
      backgroundColor="$navBar"
      borderRightWidth={1}
      borderRightColor="$borderColor"
      paddingHorizontal="$3"
      paddingVertical="$3"
      gap="$3"
      style={{ minHeight: '100dvh', transition: 'width 180ms ease' }}
    >
      {header ? <YStack>{header(Boolean(collapsed))}</YStack> : null}
      <YStack gap="$4" flex={1}>
        {sections.map((section) => (
          <YStack key={section.id} gap="$1">
            {section.label && !collapsed ? (
              <P size={5} weight="b" caps color="$textTertiary" paddingHorizontal="$3" paddingBottom="$1">
                {section.label}
              </P>
            ) : null}
            {section.items.map((it) => (
              <NavItem
                key={it.id}
                label={it.label}
                icon={it.icon}
                active={it.id === activeId}
                collapsed={collapsed}
                onPress={it.onPress}
              />
            ))}
          </YStack>
        ))}
      </YStack>
      {footer ? <YStack>{footer(Boolean(collapsed))}</YStack> : null}
    </YStack>
  )
}
