import { useMedia, XStack, YStack } from 'tamagui'
import { AppSelect } from './AppSelect'
import { FormField } from './FormField'

/** One context selector (e.g. Plant, Version). */
export interface ContextSelector {
  label: string
  value: string | null
  options: { value: string; label: string }[]
  onChange: (value: string | null) => void
  placeholder?: string
  /** Desktop field width (px). */
  width?: number
}

/** Props for {@link ContextSelectors}. */
export interface ContextSelectorsProps {
  selectors: ContextSelector[]
}

/**
 * ContextSelectors — the shared scope picker (Plant, Version, …) every operational
 * screen uses (Board, Scorecard, Workforce, simulator), so the responsive density
 * pass is decided once at the component (PHASE-3-POLISH item 1):
 *  - **desktop:** labelled `FormField` + `AppSelect`, sized per selector;
 *  - **`small`:** compact, equal-width selectors on **one row**, labels dropped
 *    (the placeholder carries meaning) — no stacked full-width dropdowns.
 *
 * @example
 * <ContextSelectors selectors={[{ label: 'Plant', value: plantId, options, onChange: setPlant }]} />
 */
export function ContextSelectors({ selectors }: ContextSelectorsProps) {
  const small = Boolean(useMedia()['max-md'])

  if (small) {
    return (
      <XStack gap="$2">
        {selectors.map((s) => (
          <YStack key={s.label} flex={1} minWidth={0}>
            <AppSelect options={s.options} value={s.value} onChange={s.onChange} placeholder={s.placeholder ?? s.label} />
          </YStack>
        ))}
      </XStack>
    )
  }

  return (
    <XStack gap="$4" flexWrap="wrap">
      {selectors.map((s) => (
        <YStack key={s.label} width={s.width ?? 260}>
          <FormField label={s.label}>
            <AppSelect options={s.options} value={s.value} onChange={s.onChange} placeholder={s.placeholder ?? s.label} />
          </FormField>
        </YStack>
      ))}
    </XStack>
  )
}
