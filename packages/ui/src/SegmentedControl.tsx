import { Text, XStack, YStack } from 'tamagui'

/** One segment option. */
export interface Segment<T extends string> {
  value: T
  label: string
}

/** Props for {@link SegmentedControl}. */
export interface SegmentedControlProps<T extends string> {
  options: Segment<T>[]
  value: T
  onChange: (value: T) => void
}

/**
 * SegmentedControl — a small pill of mutually-exclusive options (e.g. Day | Week), the
 * selected one filled. Controlled, token-themed, one component web + native. Use for a
 * compact mode switch where a dropdown would be heavier than warranted.
 *
 * @example
 * <SegmentedControl options={[{value:'day',label:'Day'},{value:'week',label:'Week'}]} value={mode} onChange={setMode} />
 */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <XStack backgroundColor="$surfaceRaised" borderRadius="$4" padding="$1" gap="$1" borderWidth={1} borderColor="$borderColor">
      {options.map((o) => {
        const active = o.value === value
        return (
          <YStack
            key={o.value}
            paddingHorizontal="$3"
            paddingVertical="$1.5"
            borderRadius="$3"
            backgroundColor={active ? '$primary' : 'transparent'}
            cursor="pointer"
            hoverStyle={active ? undefined : { backgroundColor: '$hoverFill' }}
            onPress={() => onChange(o.value)}
          >
            <Text fontSize="$3" fontWeight="600" color={active ? '$surface' : '$textSecondary'}>
              {o.label}
            </Text>
          </YStack>
        )
      })}
    </XStack>
  )
}
