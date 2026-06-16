import { TriangleAlert, Wrench } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { ConfidenceRing } from './ConfidenceRing'
import { StatusPill, type StatusTone } from './StatusPill'
import { H, P } from './typography'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** Proximity-to-the-wear-line track: std (0) → notch (the +N% line) → current/predicted fill. */
export interface WearProximity {
  /** Current/predicted value position along the track (0–1). */
  valueFrac: number
  /** The wear-line notch position (0–1) — drawn sharp. */
  notchFrac: number
  /** Caption, e.g. "std → +5% wear line". */
  caption: string
}

/** The line's wear forecast (resource-level) — synthesized impact, **no raw per-op cycle numbers**. */
export interface WearPrediction {
  /** Reconciled settled statement, e.g. "Predicted to cross the wear line in 3.8h (~05:31)". */
  statement: string
  proximity: WearProximity
  confidence: number
  confidenceLabel: string
  /** "Forecast from the trend over N actuals — not yet measured". */
  basisText: string
}

/** Props for {@link ResourceWearPanel}. */
export interface ResourceWearPanelProps {
  /** Resource name, e.g. "Press Line A". */
  title: string
  subtitle?: string
  status?: { label: string; tone: StatusTone }
  /** Tool-wear warning (D56) — "drift crossed threshold · flagged · re-sequenced". */
  warning?: { title: string; body: string }
  /** The wear forecast (present when a live prediction exists for the line). */
  prediction?: WearPrediction
  /** Minimal "so what": maintenance signal + downstream. */
  consequence?: { maintenance: string; downstream: string }
  /** Shown when the line has neither a wear warning nor a forecast (healthy). */
  emptyText?: string
}

/** Proximity track — rounded fill (value) + sharp notch (the wear line). */
function ProximityBar({ valueFrac, notchFrac, caption }: WearProximity) {
  const v = clamp(valueFrac, 0, 1) * 100
  const n = clamp(notchFrac, 0, 1) * 100
  return (
    <YStack gap="$1.5">
      <YStack position="relative" height={14} justifyContent="center">
        <XStack height={8} borderRadius="$4" backgroundColor="$surfaceRaised" overflow="hidden">
          <YStack width={`${v}%`} backgroundColor="$warning" borderRadius="$4" />
        </XStack>
        <YStack position="absolute" left={`${n}%`} top={0} width={2} height={14} backgroundColor="$danger" />
      </YStack>
      <P size={5} color="$textTertiary">
        {caption}
      </P>
    </YStack>
  )
}

/**
 * ResourceWearPanel — the **resource / line** detail (open by clicking a lane or a wear
 * flag). Owns everything about the *line's* tool wear & forecast (BAR-PANEL-FIX rewrite):
 * the **tool-wear warning** (D56), the **wear prediction** (a settled resource-level
 * statement), the **proximity track** (how close to the wear line — a bar), the
 * **confidence ring** (how sure the forecast is — a ring, not a twin bar), and the
 * **consequence**. None of this lives on the operation panel.
 */
export function ResourceWearPanel({ title, subtitle, status, warning, prediction, consequence, emptyText }: ResourceWearPanelProps) {
  const healthy = !warning && !prediction
  return (
    <YStack backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" overflow="hidden">
      <YStack padding="$4" borderBottomWidth={1} borderBottomColor="$borderColor" gap="$1">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$2">
          <YStack flex={1} gap="$1">
            <H level={4} color="$textPrimary">
              {title}
            </H>
            {subtitle ? (
              <P size={4} color="$textSecondary">
                {subtitle}
              </P>
            ) : null}
          </YStack>
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
        </XStack>
      </YStack>

      <YStack padding="$4" gap="$3">
        {healthy ? (
          <P size={3} color="$textSecondary">
            {emptyText}
          </P>
        ) : null}

        {/* Tool-wear warning (D56) — the honest "this is happening" signal. */}
        {warning ? (
          <XStack gap="$3" alignItems="flex-start" backgroundColor="$warningSoft" borderRadius="$4" padding="$3">
            <YStack width={26} height={26} borderRadius="$3" backgroundColor="$surface" alignItems="center" justifyContent="center">
              <TriangleAlert size={15} color="$warning" />
            </YStack>
            <YStack flex={1} gap="$0.5">
              <P size={3} weight="b" color="$textPrimary">
                {warning.title}
              </P>
              <P size={3} color="$textSecondary">
                {warning.body}
              </P>
            </YStack>
          </XStack>
        ) : null}

        {/* Wear prediction — the line's synthesized forecast (NO raw per-op cycle numbers;
            the 0.3→0.32 step lives on the job panel). Reconciled statement, proximity
            track (how worn), and confidence as a ring. */}
        {prediction ? (
          <>
            <P size={3} weight="m" color="$textPrimary">
              {prediction.statement}
            </P>
            <XStack gap="$4" alignItems="center">
              <YStack flex={1} gap="$2">
                <ProximityBar {...prediction.proximity} />
                <P size={4} color="$textSecondary">
                  {prediction.basisText}
                </P>
              </YStack>
              <ConfidenceRing value={prediction.confidence} label={prediction.confidenceLabel} />
            </XStack>
          </>
        ) : null}

        {/* Consequence — minimal "so what". */}
        {consequence ? (
          <YStack gap="$2" marginTop="$1" borderTopWidth={1} borderTopColor="$borderColor" paddingTop="$3">
            <XStack gap="$2" alignItems="center">
              <Wrench size={15} color="$warning" />
              <P size={3} weight="m" color="$textPrimary">
                {consequence.maintenance}
              </P>
            </XStack>
            <P size={3} color="$textSecondary">
              {consequence.downstream}
            </P>
          </YStack>
        ) : null}
      </YStack>
    </YStack>
  )
}
