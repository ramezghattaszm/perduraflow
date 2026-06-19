import { Text, XStack, YStack } from 'tamagui'

/** Display order Mon→Sun, as UTC weekday numbers (0=Sun … 6=Sat). */
const ORDER = [1, 2, 3, 4, 5, 6, 0]
/** Localized short weekday labels aligned to {@link ORDER} (Jan 1 2024 is a Monday). */
const LABELS = ORDER.map((_, i) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))),
)

/** Props for {@link WeekdayPicker}. */
export interface WeekdayPickerProps {
  /** Selected weekdays as UTC numbers (0=Sun … 6=Sat). */
  value: number[]
  onChange: (value: number[]) => void
}

/**
 * WeekdayPicker — a multi-select toggle of the seven weekdays (Mon→Sun), the selected ones
 * filled. Controlled, token-themed, one component web + native. Used for a calendar's
 * working days (which days the plant operates).
 *
 * @example
 * <WeekdayPicker value={[1,2,3,4,5,6]} onChange={setWorkingDays} />
 */
export function WeekdayPicker({ value, onChange }: WeekdayPickerProps) {
  const selected = new Set(value)
  const toggle = (day: number) => {
    const next = new Set(selected)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    onChange([...next].sort((a, b) => a - b))
  }
  return (
    <XStack gap="$2" flexWrap="wrap">
      {ORDER.map((day, i) => {
        const on = selected.has(day)
        return (
          <YStack
            key={day}
            minWidth={48}
            alignItems="center"
            paddingVertical="$2"
            paddingHorizontal="$2"
            borderRadius="$3"
            borderWidth={1}
            borderColor={on ? '$primary' : '$borderColor'}
            backgroundColor={on ? '$primary' : 'transparent'}
            cursor="pointer"
            hoverStyle={on ? undefined : { backgroundColor: '$hoverFill' }}
            onPress={() => toggle(day)}
          >
            <Text fontSize="$3" fontWeight="600" color={on ? '$surface' : '$textSecondary'}>
              {LABELS[i]}
            </Text>
          </YStack>
        )
      })}
    </XStack>
  )
}
