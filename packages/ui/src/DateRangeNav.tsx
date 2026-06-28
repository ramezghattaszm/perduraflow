import { type ComponentType, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from '@tamagui/lucide-icons'
import { type ColorTokens, XStack } from 'tamagui'
import { AppButton } from './AppButton'
import { DatePicker } from './DatePicker'
import { IconButton } from './IconButton'
import { P } from './typography'

/** A node that can report its window rect (web + native via RN measureInWindow). */
interface Measurable {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void
}
type Anchor = { x: number; y: number; width: number; height: number }

const MS_PER_DAY = 86_400_000
const utcDay = (ms: number): number => Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
/** Monday (UTC) of the week containing `ms`. */
const weekStart = (ms: number): number => utcDay(ms) - ((new Date(ms).getUTCDay() + 6) % 7) * MS_PER_DAY

/** Props for {@link DateRangeNav}. */
export interface DateRangeNavProps {
  /** `day` steps ±1 day and labels a single date; `week` steps ±1 week and labels Mon–Sun. */
  mode: 'day' | 'week'
  /** The navigated date (UTC-midnight ms). In `week` mode it selects the week it falls in. */
  valueMs: number
  onChange: (ms: number) => void
  /** Mark closed days in the picker (Sunday/holiday) — greyed (still selectable). */
  isDayClosed?: (dayMs: number) => boolean
  /** Clamp prev/next stepping to `[minMs, maxMs]` (UTC-day); arrows disable at the edges.
   *  **Today** is exempt — it always jumps to the real current date (may be outside). */
  minMs?: number
  maxMs?: number
  labels: { today: string; prev: string; next: string; pickTitle: string }
  /** When set, the **today** affordance renders as this icon (with `labels.today` as its aria-label)
   *  instead of a text button — for tight bars where "Today"/"This week" text is too wide. */
  todayIcon?: ComponentType<{ size?: number; color?: ColorTokens }>
}

const dayLabel = (ms: number): string =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ms))
const rangeLabel = (ms: number): string => {
  const s = weekStart(ms)
  const e = s + 6 * MS_PER_DAY
  const f = (x: number, withYear = false) =>
    new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(x))
  return `${f(s)} – ${f(e, true)}`
}

/**
 * DateRangeNav — the board's date stepper: ◀ ▶ arrows, a **Today** button, and a range
 * label that opens a {@link DatePicker} (tap to jump to any date/month/year). Stepping is
 * range-aware — ±1 day in `day` mode, ±1 week in `week` mode — and the label reads the
 * single date or the Mon–Sun span accordingly. Controlled; one component web + native.
 *
 * @example
 * <DateRangeNav mode="day" valueMs={viewDate} onChange={setViewDate} labels={{today:'Today',…}} />
 */
export function DateRangeNav({ mode, valueMs, onChange, isDayClosed, minMs, maxMs, labels, todayIcon }: DateRangeNavProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const triggerRef = useRef<Measurable | null>(null)
  const step = mode === 'week' ? 7 * MS_PER_DAY : MS_PER_DAY
  const label = mode === 'week' ? rangeLabel(valueMs) : dayLabel(valueMs)
  const clamp = (ms: number) => (minMs != null && ms < minMs ? minMs : maxMs != null && ms > maxMs ? maxMs : ms)
  const prevDisabled = minMs != null && utcDay(valueMs) <= minMs
  const nextDisabled = maxMs != null && utcDay(valueMs) >= maxMs

  // Measure the trigger so the popover (larger screens) anchors under it; the sheet
  // (small screens) ignores the anchor.
  const openPicker = () => {
    const node = triggerRef.current
    if (node?.measureInWindow) node.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }))
    setPickerOpen(true)
  }

  return (
    <>
      <XStack alignItems="center" gap="$1">
        <IconButton icon={ChevronLeft} label={labels.prev} disabled={prevDisabled} onPress={() => onChange(clamp(utcDay(valueMs) - step))} />
        <XStack
          ref={triggerRef as never}
          paddingHorizontal="$2"
          paddingVertical="$2"
          borderRadius="$3"
          borderWidth={1}
          borderColor="$borderColor"
          minWidth={mode === 'week' ? 168 : 132}
          justifyContent="center"
          cursor="pointer"
          hoverStyle={{ backgroundColor: '$hoverFill' }}
          onPress={openPicker}
        >
          <P size={3} weight="m" color="$textPrimary">
            {label}
          </P>
        </XStack>
        <IconButton icon={ChevronRight} label={labels.next} disabled={nextDisabled} onPress={() => onChange(clamp(utcDay(valueMs) + step))} />
        {todayIcon ? (
          <IconButton icon={todayIcon} label={labels.today} onPress={() => onChange(utcDay(Date.now()))} />
        ) : (
          <AppButton variant="ghost" size="$3" onPress={() => onChange(utcDay(Date.now()))}>
            {labels.today}
          </AppButton>
        )}
      </XStack>

      <DatePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode="single"
        value={utcDay(valueMs)}
        onChange={(v) => onChange(typeof v === 'number' ? v : v.start)}
        isDayClosed={isDayClosed}
        title={labels.pickTitle}
        anchor={anchor}
      />
    </>
  )
}
