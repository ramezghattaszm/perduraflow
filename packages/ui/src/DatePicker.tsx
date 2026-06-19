import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from '@tamagui/lucide-icons'
import { Portal, Text, useMedia, XStack, YStack } from 'tamagui'
import { IconButton } from './IconButton'
import { Popup } from './Popup'
import { P } from './typography'

const MS_PER_DAY = 86_400_000
/** Fixed popover width (> small screens) — the calendar content is not responsive. */
const POPOVER_W = 300
const POPOVER_Z = 200000

/** A picked range (UTC-midnight epoch ms); `end` null while only the start is chosen. */
export interface DateRange {
  start: number
  end: number | null
}

/** Props for {@link DatePicker}. */
export interface DatePickerProps {
  open: boolean
  onClose: () => void
  /** `single` → pick one date; `range` → pick a start then an end. */
  mode?: 'single' | 'range'
  /** Current value (UTC-midnight ms): a date in `single`, a {@link DateRange} in `range`. */
  value: number | DateRange | null
  /** Fires with the new value: a date (`single`) or a complete `{start,end}` (`range`). */
  onChange: (value: number | DateRange) => void
  /** Mark a day non-selectable + closed-styled (e.g. Sunday/holiday). UTC-midnight ms. */
  isDayClosed?: (dayMs: number) => boolean
  title?: string
  /** Popup title fallback + the month/year-jump affordance label (i18n from the caller). */
  labels?: { title?: string; monthYearHint?: string }
  /**
   * Trigger rect (viewport coords, e.g. from `measureInWindow`). On screens **larger than
   * small** the picker renders as a fixed-width **popover** anchored under it; on small
   * screens it's a bottom **sheet** (anchor ignored). Omitted → the popover falls back to a
   * top-left position.
   */
  anchor?: { x: number; y: number; width: number; height: number } | null
}

/** UTC midnight of the day containing `ms`. */
const utcDay = (ms: number): number => Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m, d)
const startOfMonth = (ms: number): number => {
  const d = new Date(ms)
  return utc(d.getUTCFullYear(), d.getUTCMonth(), 1)
}
const addMonths = (ms: number, n: number): number => {
  const d = new Date(ms)
  return utc(d.getUTCFullYear(), d.getUTCMonth() + n, 1)
}
/** Mon-first weekday index (0=Mon … 6=Sun) for a UTC date. */
const dow = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7

/** Localized short weekday labels, Mon-first (Intl; Jan 1 2024 is a Monday). */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(utc(2024, 0, 1 + i))),
)
const monthYearLabel = (ms: number): string =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms))
const monthShort = (ms: number): string =>
  new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(new Date(ms))

const asRange = (v: number | DateRange | null): DateRange | null =>
  v == null ? null : typeof v === 'number' ? { start: v, end: v } : v

/**
 * DatePicker — a cross-platform (web + native) month-grid date / date-range picker, built
 * from Tamagui primitives inside the shared {@link Popup} (no third-party calendar, no new
 * dep — one component renders identically on both platforms). Operates in **UTC days** to
 * match the scheduling engine's day model (no off-by-one vs the Gantt axis).
 *
 * Header shows the month **and** year with prev/next-month arrows; tapping the label opens a
 * **year/month jump** pane (◀ year ▶ + 12 month chips) to change the year directly. Closed
 * days (e.g. Sunday/holiday via {@link DatePickerProps.isDayClosed}) are greyed + unselectable;
 * today is marked; the selection (single day, or a highlighted range) is shown.
 *
 * @example
 * <DatePicker open={open} onClose={close} mode="single" value={dayMs} onChange={setDay} />
 */
export function DatePicker({ open, onClose, mode = 'single', value, onChange, isDayClosed, title, labels, anchor }: DatePickerProps) {
  const isSheet = Boolean(useMedia()['max-md'])
  const selected = asRange(value)
  const [cursor, setCursor] = useState(() => startOfMonth(selected?.start ?? utcDay(Date.now())))
  const [pane, setPane] = useState<'days' | 'jump'>('days')
  // Range-in-progress: when the start is chosen and we're waiting for the end.
  const [pendingStart, setPendingStart] = useState<number | null>(null)

  // Re-centre on the selected month each time the picker opens.
  useEffect(() => {
    if (open) {
      setCursor(startOfMonth(selected?.start ?? utcDay(Date.now())))
      setPane('days')
      setPendingStart(null)
    }
  }, [open])

  const today = utcDay(Date.now())
  const cells = useMemo(() => {
    const first = startOfMonth(cursor)
    const lead = dow(first)
    const gridStart = first - lead * MS_PER_DAY
    return Array.from({ length: 42 }, (_, i) => gridStart + i * MS_PER_DAY)
  }, [cursor])

  const pick = (dayMs: number) => {
    if (mode === 'single') {
      onChange(dayMs)
      onClose()
      return
    }
    // range: first pick sets start; second completes (swap if before start).
    if (pendingStart == null) {
      setPendingStart(dayMs)
    } else {
      const start = Math.min(pendingStart, dayMs)
      const end = Math.max(pendingStart, dayMs)
      setPendingStart(null)
      onChange({ start, end })
      onClose()
    }
  }

  const rangeStart = pendingStart ?? selected?.start ?? null
  const rangeEnd = pendingStart != null ? null : selected?.end ?? null
  const inRange = (dayMs: number): boolean =>
    rangeStart != null && rangeEnd != null && dayMs >= rangeStart && dayMs <= rangeEnd
  const isStart = (dayMs: number): boolean => rangeStart != null && dayMs === rangeStart
  const isEnd = (dayMs: number): boolean => rangeEnd != null && dayMs === rangeEnd

  const monthCursorYear = new Date(cursor).getUTCFullYear()

  const content = (
      <YStack gap="$3">
        {pane === 'days' ? (
          <>
            {/* month/year header — arrows step months; the label jumps to year/month */}
            <XStack alignItems="center" justifyContent="space-between">
              <IconButton icon={ChevronLeft} label="Previous month" onPress={() => setCursor(addMonths(cursor, -1))} />
              <XStack
                paddingHorizontal="$2"
                paddingVertical="$1.5"
                borderRadius="$3"
                cursor="pointer"
                hoverStyle={{ backgroundColor: '$hoverFill' }}
                onPress={() => setPane('jump')}
              >
                <P size={3} weight="b" color="$textPrimary">
                  {monthYearLabel(cursor)}
                </P>
              </XStack>
              <IconButton icon={ChevronRight} label="Next month" onPress={() => setCursor(addMonths(cursor, 1))} />
            </XStack>

            {/* weekday header (Mon-first) */}
            <XStack>
              {WEEKDAYS.map((w) => (
                <YStack key={w} flex={1} alignItems="center">
                  <P size={5} weight="b" caps color="$textTertiary">
                    {w}
                  </P>
                </YStack>
              ))}
            </XStack>

            {/* 6-week day grid */}
            <YStack gap="$1">
              {Array.from({ length: 6 }, (_, r) => (
                <XStack key={r} gap="$1">
                  {cells.slice(r * 7, r * 7 + 7).map((dayMs) => {
                    const outside = new Date(dayMs).getUTCMonth() !== new Date(cursor).getUTCMonth()
                    const closed = isDayClosed?.(dayMs) ?? false
                    const start = isStart(dayMs)
                    const end = isEnd(dayMs)
                    const within = inRange(dayMs) && !start && !end
                    const selectedDay = start || end
                    return (
                      <YStack
                        key={dayMs}
                        flex={1}
                        height={36}
                        alignItems="center"
                        justifyContent="center"
                        borderRadius="$3"
                        backgroundColor={selectedDay ? '$primary' : within ? '$primarySoft' : 'transparent'}
                        opacity={closed && !selectedDay ? 0.4 : 1}
                        cursor="pointer"
                        hoverStyle={selectedDay ? undefined : { backgroundColor: '$hoverFill' }}
                        onPress={() => pick(dayMs)}
                      >
                        <Text
                          fontSize="$3"
                          fontWeight={dayMs === today ? '800' : '500'}
                          color={selectedDay ? '$surface' : outside ? '$textTertiary' : dayMs === today ? '$primary' : '$textPrimary'}
                        >
                          {new Date(dayMs).getUTCDate()}
                        </Text>
                      </YStack>
                    )
                  })}
                </XStack>
              ))}
            </YStack>
          </>
        ) : (
          <>
            {/* year/month jump pane */}
            <XStack alignItems="center" justifyContent="space-between">
              <IconButton icon={ChevronLeft} label="Previous year" onPress={() => setCursor(addMonths(cursor, -12))} />
              <P size={3} weight="b" color="$textPrimary">
                {monthCursorYear}
              </P>
              <IconButton icon={ChevronRight} label="Next year" onPress={() => setCursor(addMonths(cursor, 12))} />
            </XStack>
            <YStack gap="$1.5">
              {Array.from({ length: 4 }, (_, r) => (
                <XStack key={r} gap="$1.5">
                  {Array.from({ length: 3 }, (_, c) => {
                    const m = r * 3 + c
                    const monthMs = utc(monthCursorYear, m, 1)
                    const isCur = m === new Date(cursor).getUTCMonth()
                    return (
                      <YStack
                        key={m}
                        flex={1}
                        height={40}
                        alignItems="center"
                        justifyContent="center"
                        borderRadius="$3"
                        backgroundColor={isCur ? '$primary' : '$surfaceRaised'}
                        cursor="pointer"
                        hoverStyle={isCur ? undefined : { backgroundColor: '$hoverFill' }}
                        onPress={() => {
                          setCursor(monthMs)
                          setPane('days')
                        }}
                      >
                        <Text fontSize="$3" fontWeight="600" color={isCur ? '$surface' : '$textPrimary'}>
                          {monthShort(monthMs)}
                        </Text>
                      </YStack>
                    )
                  })}
                </XStack>
              ))}
            </YStack>
          </>
        )}
      </YStack>
  )

  // Small screens → the shared bottom sheet. Larger screens → a fixed-width popover
  // anchored under the trigger (not a centered alert), with a transparent dismiss layer.
  if (isSheet) {
    return (
      <Popup open={open} onClose={onClose} title={title ?? labels?.title} size="small">
        {content}
      </Popup>
    )
  }
  if (!open) return null
  const left = anchor ? Math.max(8, anchor.x + anchor.width - POPOVER_W) : 80
  const top = anchor ? anchor.y + anchor.height + 6 : 80
  return (
    <Portal>
      {/* The Tamagui Portal host is pointer-events:none and it inherits — both the dismiss
          scrim and the popover must re-enable hit-testing, or clicks/hover fall through to
          the content behind (here: the Gantt bars). The popover also stops propagation so a
          click inside it doesn't reach the dismiss layer. */}
      <YStack position="fixed" top={0} left={0} right={0} bottom={0} zIndex={POPOVER_Z} pointerEvents="auto" onPress={onClose} />
      <YStack
        position="fixed"
        top={top}
        left={left}
        width={POPOVER_W}
        zIndex={POPOVER_Z + 1}
        pointerEvents="auto"
        onPress={(e) => e.stopPropagation()}
        backgroundColor="$surface"
        borderColor="$borderColor"
        borderWidth={1}
        borderRadius="$4"
        padding="$3"
        elevation="$4"
      >
        {content}
      </YStack>
    </Portal>
  )
}
