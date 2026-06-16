import { XStack, YStack } from 'tamagui'
import { AppButton } from './AppButton'
import { P } from './typography'

/** Props for {@link CoverageProposal}. */
export interface CoverageProposalProps {
  /** Section heading, e.g. "Re-balance proposed". */
  heading: string
  /** The gap statement, e.g. "Leak-test station has no certified operator next shift." */
  gapText: string
  /** The proposed action, e.g. "→ Call in Jorge Morales on overtime". */
  actionText: string
  /** Sub-line, e.g. "certified · within OT rules · service protected". */
  detailText: string
  confirmLabel: string
  confirmedLabel: string
  confirmed: boolean
  loading?: boolean
  onConfirm: () => void
}

/**
 * CoverageProposal — the cert-gap → named-operator OT call-in (View 3, D54). A
 * **human-confirmed proposal** (labor-aware, never rostering — D43): the system
 * proposes, a human confirms. Presentational; confirm wiring is the caller's
 * (ConfigureGuard-gated upstream).
 *
 * @example
 * <CoverageProposal heading="Re-balance proposed" gapText="…" actionText="→ Call in J. Morales"
 *   detailText="certified · within OT rules" confirmLabel="Approve OT call-in" confirmed={false} onConfirm={fn} />
 */
export function CoverageProposal({
  heading,
  gapText,
  actionText,
  detailText,
  confirmLabel,
  confirmedLabel,
  confirmed,
  loading,
  onConfirm,
}: CoverageProposalProps) {
  return (
    <YStack backgroundColor="$surfaceRaised" borderWidth={1} borderColor="$warning" borderRadius="$4" padding="$3" gap="$2">
      <P size={5} weight="b" caps color="$warning">
        {heading}
      </P>
      <P size={3} color="$textPrimary">
        {gapText}
      </P>
      <P size={3} color="$primary">
        {actionText}
      </P>
      <P size={4} color="$textSecondary">
        {detailText}
      </P>
      {confirmed ? (
        <XStack alignItems="center" gap="$2" paddingTop="$1">
          <YStack width={8} height={8} borderRadius={999} backgroundColor="$success" />
          <P size={5} weight="m" color="$success">
            {confirmedLabel}
          </P>
        </XStack>
      ) : (
        <XStack paddingTop="$1">
          <AppButton variant="primary" size="$3" loading={loading} onPress={onConfirm}>
            {confirmLabel}
          </AppButton>
        </XStack>
      )}
    </YStack>
  )
}
