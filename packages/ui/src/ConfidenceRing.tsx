import { Circle, Svg } from 'react-native-svg'
import { useTheme, YStack } from 'tamagui'
import { P } from './typography'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** Props for {@link ConfidenceRing}. */
export interface ConfidenceRingProps {
  /** 0–1. */
  value: number
  /** Caption beneath the ring, e.g. "Confidence". */
  label: string
  size?: number
}

/**
 * ConfidenceRing — a small **labeled ring** (% inside, label beneath) for a forecast's
 * confidence. A ring (different shape) so it never reads like the proximity **bar**
 * beside it (BAR-PANEL-FIX). The track is drawn in `$borderColor` and the progress arc
 * in `$ml` — both **visible against `$surface`** (the prior bug was an unanchored SVG
 * that didn't paint). Built on `react-native-svg` → web + native (same as the Gantt).
 */
export function ConfidenceRing({ value, label, size = 60 }: ConfidenceRingProps) {
  const pct = clamp(value, 0, 1)
  const theme = useTheme()
  const stroke = 6
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const ml = theme.ml?.val ?? '#7c5cff'
  const track = theme.borderColor?.val ?? 'rgba(0,0,0,0.12)'
  const center = size / 2
  return (
    <YStack alignItems="center" gap="$1">
      <YStack width={size} height={size} alignItems="center" justifyContent="center" position="relative">
        <Svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Circle cx={center} cy={center} r={r} stroke={track} strokeWidth={stroke} fill="none" />
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={ml}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circ}`}
            strokeDashoffset={circ * (1 - pct)}
            transform={`rotate(-90 ${center} ${center})`}
          />
        </Svg>
        <P size={3} weight="b" color="$textPrimary">
          {Math.round(pct * 100)}%
        </P>
      </YStack>
      <P size={5} weight="b" caps color="$textTertiary">
        {label}
      </P>
    </YStack>
  )
}
