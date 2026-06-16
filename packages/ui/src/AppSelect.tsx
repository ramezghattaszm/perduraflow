import { useRef, useState } from 'react'
import { ChevronDown } from '@tamagui/lucide-icons'
import { Portal, ScrollView, XStack, YStack } from 'tamagui'
import { P } from './typography'

/** One option in an {@link AppSelect}. */
export interface AppSelectOption {
  value: string
  label: string
}

/** Props for {@link AppSelect}. */
export interface AppSelectProps {
  options: AppSelectOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
}

interface Measurable {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void
}
interface Anchor {
  x: number
  y: number
  width: number
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
export function AppSelect({ options, value, onChange, placeholder = 'Select…' }: AppSelectProps) {
  const triggerRef = useRef<Measurable | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const selected = options.find((o) => o.value === value)

  const open = () => {
    const node = triggerRef.current
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, width, height) => setAnchor({ x, y: y + height + 4, width }))
    } else {
      setAnchor({ x: 0, y: 0, width: 240 })
    }
  }

  return (
    <YStack>
      <XStack
        ref={triggerRef as never}
        onPress={() => (anchor ? setAnchor(null) : open())}
        cursor="pointer"
        alignItems="center"
        justifyContent="space-between"
        gap="$2"
        height={40}
        paddingHorizontal="$3"
        borderWidth={1}
        borderColor="$borderColor"
        borderRadius="$4"
        backgroundColor="$surface"
        hoverStyle={{ borderColor: '$primary' }}
        role="button"
        aria-label={selected?.label ?? placeholder}
      >
        <P size={3} weight={selected ? 'm' : 'r'} color={selected ? '$textPrimary' : '$textSecondary'} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </P>
        <ChevronDown size={16} color="$textSecondary" />
      </XStack>

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
            onPress={() => setAnchor(null)}
          />
          <YStack
            position="fixed"
            top={anchor.y}
            left={anchor.x}
            width={anchor.width}
            maxHeight={300}
            zIndex={250001}
            pointerEvents="auto"
            backgroundColor="$surfaceRaised"
            borderColor="$borderColor"
            borderWidth={1}
            borderRadius="$4"
            elevation="$4"
            overflow="hidden"
          >
            <ScrollView>
              {options.map((o) => (
                <XStack
                  key={o.value}
                  onPress={() => {
                    onChange(o.value)
                    setAnchor(null)
                  }}
                  cursor="pointer"
                  paddingHorizontal="$3"
                  paddingVertical="$2.5"
                  backgroundColor={o.value === value ? '$primarySoft' : 'transparent'}
                  hoverStyle={{ backgroundColor: o.value === value ? '$primarySoft' : '$hoverFill' }}
                  role="button"
                  aria-label={o.label}
                >
                  <P size={3} weight={o.value === value ? 'b' : 'r'} color={o.value === value ? '$primary' : '$textPrimary'} numberOfLines={1}>
                    {o.label}
                  </P>
                </XStack>
              ))}
            </ScrollView>
          </YStack>
        </Portal>
      ) : null}
    </YStack>
  )
}
