import type { ReactNode } from 'react'
import { styled, XStack, YStack } from 'tamagui'
import { P } from './typography'

/**
 * SidebarNav — the web/tablet shell navigation: an optional header slot, a
 * labelled section of nav items, and an optional footer slot. Items highlight by
 * `activeId`. One component so navigation never gets re-styled per screen.
 *
 * @example
 * <SidebarNav items={items} activeId="plants" header={<Brand/>} footer={<SignOut/>} />
 */
export interface NavEntry {
  id: string
  label: string
  onPress: () => void
}

// Selection is shown by the font color only — no active background or box.
const ItemFrame = styled(XStack, {
  name: 'NavItem',
  alignItems: 'center',
  borderRadius: '$4',
  paddingHorizontal: '$3',
  paddingVertical: '$3',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  hoverStyle: { backgroundColor: '$background' },
})

/** A single nav row (exported for direct use/composition). Active = primary font, no box. */
export function NavItem({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <ItemFrame onPress={onPress}>
      <P size={3} weight={active ? 'b' : 'm'} color={active ? '$primary' : '$textPrimary'}>
        {label}
      </P>
    </ItemFrame>
  )
}

/** Vertical sidebar navigation. */
export function SidebarNav({
  items,
  activeId,
  sectionLabel,
  header,
  footer,
}: {
  items: NavEntry[]
  activeId?: string
  sectionLabel?: string
  header?: ReactNode
  footer?: ReactNode
}) {
  return (
    <YStack
      width={248}
      backgroundColor="$surface"
      borderRightWidth={1}
      borderRightColor="$borderColor"
      padding="$3"
      gap="$2"
      style={{ minHeight: '100dvh' }}
    >
      {header ? <YStack paddingHorizontal="$2" paddingVertical="$3">{header}</YStack> : null}
      {sectionLabel ? (
        <P size={6} weight="b" color="$textSecondary" paddingHorizontal="$3" paddingTop="$2">
          {sectionLabel.toUpperCase()}
        </P>
      ) : null}
      <YStack gap="$1" flex={1}>
        {items.map((it) => (
          <NavItem key={it.id} label={it.label} active={it.id === activeId} onPress={it.onPress} />
        ))}
      </YStack>
      {footer ? <YStack padding="$2">{footer}</YStack> : null}
    </YStack>
  )
}
