import { type ReactNode, useRef, useState } from 'react'
import { Dimensions } from 'react-native'
import { ChevronDown, Search } from '@tamagui/lucide-icons'
import { Input, Portal, ScrollView, XStack, YStack } from 'tamagui'
import { P } from './typography'

/** One option in an {@link AppSelect}. */
export interface AppSelectOption {
  value: string
  label: string
  /** Greyed out + not selectable (e.g. an operator already assigned to another line). */
  disabled?: boolean
}

/** Props for {@link AppSelect}. */
export interface AppSelectProps {
  options: AppSelectOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  /**
   * Trigger style: `box` (default) is the bordered field; `inline` is a dashed-underlined text link
   * (no border/box) — for "click the value to edit it" affordances inside dense panels.
   */
  variant?: 'box' | 'inline'
  /** Override the text shown on the trigger (else the selected option's label / placeholder). */
  triggerLabel?: string
  /** A leading glyph inside the `box` trigger (e.g. a filter icon). When set, the trigger reads as a
   *  button — icon + label, left-aligned, no dropdown chevron — opening the same popover menu. */
  leadingIcon?: ReactNode
  /** Looser popover rows + no inter-row separators (a roomier menu). Default `false` keeps the
   *  compact, divided list so existing selects are unchanged. */
  looseMenu?: boolean
  /** Show a type-to-filter search field at the top of the popover (case-insensitive substring match on
   *  the label). For long lists (e.g. hundreds of orders). Default `false` keeps the plain list. */
  searchable?: boolean
  /** Placeholder for the search field (only when `searchable`). */
  searchPlaceholder?: string
  /** Shown in the menu when a search matches no options (only when `searchable`). */
  noMatchesText?: string
}

interface Measurable {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void
}
interface Anchor {
  x: number
  /** Anchored from the top (opens down) or the bottom (opens up) — whichever keeps it on-screen. */
  y?: number
  bottom?: number
  width: number
  maxHeight: number
}

/**
 * AppSelect — a single-select **dropdown** (trigger + popover list), for when the
 * chip-based `SelectField` would spread too wide (e.g. the board's plant/version
 * pickers). The list is portaled and positioned under the trigger via
 * `measureInWindow`, so it works on web and native and isn't clipped by scroll
 * parents; an outside-click scrim closes it.
 *
 * @example
 * <AppSelect options={plants} value={plantId} onChange={setPlantId} placeholder="Plant" />
 */
export function AppSelect({ options, value, onChange, placeholder = 'Select…', variant = 'box', triggerLabel, leadingIcon, looseMenu = false, searchable = false, searchPlaceholder = 'Search…', noMatchesText = 'No matches' }: AppSelectProps) {
  const triggerRef = useRef<Measurable | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [query, setQuery] = useState('')
  const selected = options.find((o) => o.value === value)
  const label = triggerLabel ?? selected?.label ?? placeholder
  const inline = variant === 'inline'
  // Type-to-filter (searchable only): case-insensitive substring on the label. Trimmed so trailing
  // spaces don't blank the list. When not searchable (or no query), the full option set shows.
  const q = query.trim().toLowerCase()
  const visibleOptions = searchable && q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  const close = () => {
    setAnchor(null)
    setQuery('')
  }

  // Position the dropdown so it always stays on-screen: open DOWN when there's room below, otherwise
  // open UP (anchored to the trigger's top); clamp the left edge to the viewport; and cap the height
  // to the available space so a long list scrolls within view instead of running off the screen.
  const open = () => {
    const node = triggerRef.current
    const screen = Dimensions.get('window')
    if (!node?.measureInWindow) {
      setAnchor({ x: 8, y: 8, width: 240, maxHeight: 300 })
      return
    }
    node.measureInWindow((x, y, width, height) => {
      const gap = 4
      const spaceBelow = screen.height - (y + height) - 8
      const spaceAbove = y - 8
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow
      const maxHeight = Math.max(120, Math.min(300, openUp ? spaceAbove : spaceBelow))
      // An inline trigger is just the text, so its width can't size the dropdown — give the list a
      // generous minimum so option labels aren't truncated; box triggers keep their own width. Always
      // clamp to the viewport so a wide list never runs off the right edge.
      const w = Math.min(screen.width - 16, Math.max(width, inline ? 360 : 240))
      const left = Math.max(8, Math.min(x, screen.width - w - 8))
      setAnchor(
        openUp
          ? { x: left, bottom: screen.height - y + gap, width: w, maxHeight }
          : { x: left, y: y + height + gap, width: w, maxHeight },
      )
    })
  }

  return (
    <YStack>
      {inline ? (
        <XStack
          ref={triggerRef as never}
          onPress={() => (anchor ? close() : open())}
          cursor="pointer"
          alignSelf="flex-start"
          hoverStyle={{ opacity: 0.7 }}
          role="button"
          aria-label={label}
        >
          <P
            size={3}
            weight="m"
            color="$textPrimary"
            numberOfLines={1}
            style={{ textDecorationLine: 'underline', textDecorationStyle: 'dashed' }}
          >
            {label}
          </P>
        </XStack>
      ) : (
        <XStack
          ref={triggerRef as never}
          onPress={() => (anchor ? close() : open())}
          cursor="pointer"
          alignItems="center"
          justifyContent={leadingIcon ? 'flex-start' : 'space-between'}
          gap="$2"
          height={40}
          paddingHorizontal="$3"
          borderWidth={1}
          borderColor="$borderColor"
          borderRadius="$4"
          backgroundColor="$surface"
          hoverStyle={{ borderColor: '$primary' }}
          role="button"
          aria-label={label}
        >
          {leadingIcon}
          <P
            size={3}
            weight={selected ? 'm' : 'r'}
            color={selected ? '$textPrimary' : '$textSecondary'}
            numberOfLines={1}
          >
            {label}
          </P>
          {/* The chevron is the dropdown affordance — dropped when a leading icon makes this a button. */}
          {leadingIcon ? null : (
            <ChevronDown
              size={16}
              color="$textSecondary"
            />
          )}
        </XStack>
      )}

      {anchor ? (
        <Portal>
          <YStack
            position="fixed"
            top={0}
            left={0}
            right={0}
            bottom={0}
            zIndex={250000}
            pointerEvents="auto"
            onPress={close}
          />
          <YStack
            position="fixed"
            {...(anchor.y != null ? { top: anchor.y } : { bottom: anchor.bottom })}
            left={anchor.x}
            width={anchor.width}
            zIndex={250001}
            pointerEvents="auto"
            backgroundColor="$surfaceRaised"
            borderColor="$borderColor"
            borderWidth={1}
            borderRadius="$4"
            elevation="$4"
            overflow="hidden"
          >
            {/* Type-to-filter field — sticky above the scroll list so it stays put while the (filtered)
                options scroll. Autofocused on open; the divider separates it from the rows. */}
            {searchable ? (
              <XStack
                alignItems="center"
                gap="$2"
                paddingHorizontal="$3"
                height={40}
                borderBottomWidth={1}
                borderBottomColor="$borderColor"
              >
                <Search size={15} color="$textSecondary" />
                <Input
                  flex={1}
                  unstyled
                  autoFocus
                  value={query}
                  onChangeText={setQuery}
                  placeholder={searchPlaceholder}
                  placeholderTextColor="$textTertiary"
                  color="$textPrimary"
                  fontSize={14}
                  borderWidth={0}
                  backgroundColor="transparent"
                  aria-label={searchPlaceholder}
                />
              </XStack>
            ) : null}
            {/* maxHeight (computed from the available space) lives on the ScrollView so a long list
                caps the scroll container and scrolls within view instead of being clipped/off-screen. */}
            <ScrollView maxHeight={anchor.maxHeight}>
              {/* A basic vertical list: full-width rows (click anywhere to select), a thin divider
                  between rows (no per-item border/pill), and compact padding. */}
              <YStack>
                {searchable && visibleOptions.length === 0 ? (
                  <XStack paddingHorizontal="$3" paddingVertical="$2.5">
                    <P size={3} color="$textTertiary" numberOfLines={1}>
                      {noMatchesText}
                    </P>
                  </XStack>
                ) : null}
                {visibleOptions.map((o, i) => (
                  <XStack
                    key={o.value}
                    onPress={
                      o.disabled
                        ? undefined
                        : () => {
                            onChange(o.value)
                            close()
                          }
                    }
                    cursor={o.disabled ? 'default' : 'pointer'}
                    opacity={o.disabled ? 0.45 : 1}
                    paddingHorizontal="$3"
                    paddingVertical={looseMenu ? '$2.5' : '$1.5'}
                    backgroundColor={o.value === value ? '$primarySoft' : 'transparent'}
                    hoverStyle={o.disabled ? undefined : { backgroundColor: o.value === value ? '$primarySoft' : '$hoverFill' }}
                    {...(i > 0 && !looseMenu ? { borderTopWidth: 1, borderTopColor: '$borderColor' } : {})}
                    role="button"
                    aria-label={o.label}
                    aria-disabled={o.disabled}
                  >
                    <P
                      size={3}
                      weight={o.value === value ? 'b' : 'r'}
                      color={o.disabled ? '$textTertiary' : o.value === value ? '$primary' : '$textPrimary'}
                      numberOfLines={1}
                    >
                      {o.label}
                    </P>
                  </XStack>
                ))}
              </YStack>
            </ScrollView>
          </YStack>
        </Portal>
      ) : null}
    </YStack>
  )
}
