import { ArrowUpRight } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { StatusPill, type StatusTone } from './StatusPill'
import { H, P } from './typography'

const PERF_TONE = { ok: '$success', warn: '$warning', bad: '$danger' } as const

/** Op-panel provenance — **operation-level only**. Line-level wear/forecast lives on
 *  the resource surface ({@link ResourceWearPanel}), never here (BAR-PANEL-FIX rewrite).
 *  `predicted` = a pre-adopted forecast (`ml_predicted`) applied to this op ahead of the
 *  drift materialising — distinct from `measured` (`ml_adjusted`, learned from actuals). */
export type ParamProvenance = 'standard' | 'measured' | 'predicted'

/** A planned-vs-actual performance row — shown whenever the op has actuals. */
export interface PerfRow {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'bad'
}

/** Measured (ml_adjusted) — the settled std→learned step for THIS op. No confidence here
 *  (confidence belongs to the line-level forecast, not the op's measured cycle). */
export interface MeasuredDetail {
  standardText: string
  learnedText: string
  deltaText: string
  /** "Learned from N actuals" (N > 0). */
  basisText: string
  /** "settled — holding steady". */
  settledText: string
}

/** Predicted (ml_predicted) — a pre-adopted forecast value applied to THIS op ahead of the
 *  drift materialising. The std→predicted step is shown like {@link MeasuredDetail} but with
 *  forecast vocabulary: not learned from actuals, reversible if it doesn't materialise. */
export interface PredictedDetail {
  standardText: string
  predictedText: string
  deltaText: string
  /** "Pre-adopted forecast" — the basis (not actuals). */
  basisText: string
  /** "not yet measured — reversible". */
  noteText: string
}

/** Props for {@link LearnedParamPanel} (the OPERATION panel). */
export interface LearnedParamPanelProps {
  title: string
  subtitle?: string
  /** Optional status (e.g. at-risk) → a {@link StatusPill} in the header's top-right. */
  status?: { label: string; tone: StatusTone }
  /** Identity / schedule facts repeated at the top so the panel stands alone. */
  scheduleRows?: { label: string; value: string }[]
  metricLabel: string
  /** Source badge — "std" | "ml". */
  sourceText: string
  provenance: ParamProvenance
  // standard:
  standardText?: string
  standardNote?: string
  secondary?: { label: string; value: string }
  // measured:
  measured?: MeasuredDetail
  // predicted (pre-adopted forecast):
  predicted?: PredictedDetail
  /** Performance (planned-vs-actual) — shown whenever the op has actuals, **independent of
   *  any line forecast**. Pass `rows` when actuals exist; `emptyText` otherwise. */
  performance?: { label: string; rows?: PerfRow[]; emptyText: string }
  /** A small pointer to the line surface when the resource has a wear forecast — the
   *  prediction itself lives on {@link ResourceWearPanel}, never in the op panel. */
  wearPointer?: { label: string; onPress: () => void }
}

/**
 * LearnedParamPanel — the **operation** detail opened by clicking a board bar. It shows
 * ONLY this operation's facts (identity, its cycle, planned-vs-actual performance) and
 * carries **no** line-level wear / wear-prediction / prediction-confidence — those are
 * resource-level and live on {@link ResourceWearPanel} (at most a pointer to it here).
 * Provenance drives vocabulary: **measured** (`ml_adjusted`) = the settled std→learned
 * step + "Learned from N actuals · settled"; **standard** = the op's standard time(s) +
 * "no learned adjustment yet". **Performance shows whenever actuals exist** (period).
 */
export function LearnedParamPanel({
  title,
  subtitle,
  status,
  scheduleRows,
  metricLabel,
  sourceText,
  provenance,
  standardText,
  standardNote,
  secondary,
  measured,
  predicted,
  performance,
  wearPointer,
}: LearnedParamPanelProps) {
  const isMeasured = provenance === 'measured' && Boolean(measured)
  const isPredicted = provenance === 'predicted' && Boolean(predicted)
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
        {scheduleRows && scheduleRows.length > 0 ? (
          <YStack gap="$1.5" marginTop="$2">
            {scheduleRows.map((r) => (
              <XStack key={r.label} justifyContent="space-between" gap="$3" alignItems="center">
                <P size={5} weight="b" caps color="$textTertiary">
                  {r.label}
                </P>
                <P size={3} weight="m" color="$textPrimary">
                  {r.value}
                </P>
              </XStack>
            ))}
          </YStack>
        ) : null}
      </YStack>

      <YStack padding="$4" gap="$3">
        <XStack alignItems="center" justifyContent="space-between" gap="$2">
          <P size={5} weight="b" caps color="$textTertiary">
            {metricLabel}
          </P>
          <XStack
            backgroundColor={isMeasured ? '$mlSoft' : isPredicted ? '$warningSoft' : '$surfaceRaised'}
            borderRadius="$3"
            paddingHorizontal="$2"
            paddingVertical="$0.5"
          >
            <P size={5} weight="b" color={isMeasured ? '$ml' : isPredicted ? '$warning' : '$textSecondary'}>
              {sourceText}
            </P>
          </XStack>
        </XStack>

        {isPredicted && predicted ? (
          // predicted cycle: a pre-adopted forecast (std→predicted), acted on ahead of the drift.
          // Amber (forecast) vocabulary — NOT the purple settled-measured step.
          <>
            <XStack alignItems="center" gap="$3" flexWrap="wrap">
              <P size={3} color="$textSecondary" style={{ textDecorationLine: 'line-through' }}>
                {predicted.standardText}
              </P>
              <P size={3} color="$warning">
                →
              </P>
              <H level={3} color="$textPrimary">
                {predicted.predictedText}
              </H>
              <XStack backgroundColor="$warningSoft" borderRadius="$3" paddingHorizontal="$2" paddingVertical="$0.5">
                <P size={5} weight="b" color="$warning">
                  {predicted.deltaText}
                </P>
              </XStack>
            </XStack>
            <XStack alignItems="center" gap="$2" flexWrap="wrap">
              <P size={3} color="$textSecondary">
                {predicted.basisText}
              </P>
              <P size={5} weight="m" color="$warning">
                {predicted.noteText}
              </P>
            </XStack>
          </>
        ) : isMeasured && measured ? (
          // measured cycle: the settled std→learned step (this op's own cycle)
          <>
            <XStack alignItems="center" gap="$3" flexWrap="wrap">
              <P size={3} color="$textSecondary" style={{ textDecorationLine: 'line-through' }}>
                {measured.standardText}
              </P>
              <P size={3} color="$ml">
                →
              </P>
              <H level={3} color="$textPrimary">
                {measured.learnedText}
              </H>
              <XStack backgroundColor="$mlSoft" borderRadius="$3" paddingHorizontal="$2" paddingVertical="$0.5">
                <P size={5} weight="b" color="$ml">
                  {measured.deltaText}
                </P>
              </XStack>
            </XStack>
            <XStack alignItems="center" gap="$2" flexWrap="wrap">
              <P size={3} color="$textSecondary">
                {measured.basisText}
              </P>
              <P size={5} weight="m" color="$success">
                {measured.settledText}
              </P>
            </XStack>
          </>
        ) : (
          // standard cycle: the op's standard time(s)
          <>
            <XStack alignItems="baseline" gap="$3">
              <H level={3} color="$textPrimary">
                {standardText}
              </H>
              {secondary ? (
                <P size={4} color="$textSecondary">
                  {secondary.label} {secondary.value}
                </P>
              ) : null}
            </XStack>
            {standardNote ? (
              <P size={3} color="$textSecondary">
                {standardNote}
              </P>
            ) : null}
          </>
        )}

        {/* Performance — planned vs actual for THIS op; shown whenever actuals exist
            (independent of any line forecast). */}
        {performance ? (
          <YStack gap="$2" marginTop="$1" borderTopWidth={1} borderTopColor="$borderColor" paddingTop="$3">
            <P size={5} weight="b" caps color="$textTertiary">
              {performance.label}
            </P>
            {performance.rows && performance.rows.length > 0 ? (
              performance.rows.map((r) => (
                <XStack key={r.label} justifyContent="space-between" gap="$3" alignItems="center">
                  <P size={4} color="$textSecondary">
                    {r.label}
                  </P>
                  <P size={3} weight="m" color={r.tone ? PERF_TONE[r.tone] : '$textPrimary'}>
                    {r.value}
                  </P>
                </XStack>
              ))
            ) : (
              <P size={3} color="$textSecondary">
                {performance.emptyText}
              </P>
            )}
          </YStack>
        ) : null}

        {/* Pointer to the line surface — the wear/forecast itself lives there, not here. */}
        {wearPointer ? (
          <XStack
            onPress={wearPointer.onPress}
            cursor="pointer"
            alignItems="center"
            gap="$2"
            marginTop="$1"
            borderTopWidth={1}
            borderTopColor="$borderColor"
            paddingTop="$3"
            hoverStyle={{ opacity: 0.8 }}
          >
            <P size={3} weight="m" color="$warning" flex={1}>
              {wearPointer.label}
            </P>
            <ArrowUpRight size={16} color="$warning" />
          </XStack>
        ) : null}
      </YStack>
    </YStack>
  )
}
