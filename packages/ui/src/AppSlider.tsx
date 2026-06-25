import { Slider } from '@tamagui/slider'

/** Props for {@link AppSlider}. */
export interface AppSliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Tone of the active track + thumb — `primary` (default) or `warning` (e.g. a guard-breaching value). */
  tone?: 'primary' | 'warning'
  disabled?: boolean
}

/**
 * AppSlider — a single-thumb range control on the design tokens. Controlled (`value`/`onChange`);
 * `tone` switches the active track/thumb to `$warning` so a screen can signal an out-of-bounds value
 * (e.g. the firm-lateness-dominance guard) without restyling. Disabled is opacity + no pointer events
 * (the same rule as the other pressables — never a `disabled` prop on the interactive frame).
 *
 * @example
 * <AppSlider value={w} onChange={setW} min={0} max={20} step={0.1} tone={ok ? 'primary' : 'warning'} />
 */
export function AppSlider({ value, onChange, min = 0, max = 100, step = 1, tone = 'primary', disabled }: AppSliderProps) {
  const active = tone === 'warning' ? '$warning' : '$primary'
  return (
    <Slider
      value={[Math.min(Math.max(value, min), max)]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v[0] ?? min)}
      opacity={disabled ? 0.5 : 1}
      pointerEvents={disabled ? 'none' : 'auto'}
      cursor={disabled ? 'default' : 'pointer'}
    >
      <Slider.Track backgroundColor="$borderColor" height={6}>
        <Slider.TrackActive backgroundColor={active} />
      </Slider.Track>
      <Slider.Thumb
        index={0}
        circular
        size="$1"
        backgroundColor={active}
        borderColor="$surface"
        borderWidth={2}
      />
    </Slider>
  )
}
