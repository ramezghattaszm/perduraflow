import { Check, TriangleAlert } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { FactorBar, type FactorRow } from './FactorBar'
import { P } from './typography'

/** A resolved binding-constraint row. */
export interface ConstraintRow {
  label: string
  detail: string
  binding: boolean
  type: 'hard' | 'soft'
}

/** A resolved comparative sentence ("X preferred over Y, driven by changeover"). */
export interface ComparativeRow {
  text: string
}

/** Props for {@link RationaleView}. */
export interface RationaleViewProps {
  factors: FactorRow[]
  constraints: ConstraintRow[]
  comparatives: ComparativeRow[]
  /** Section titles (resolved by the screen). */
  factorsTitle: string
  constraintsTitle: string
  comparativesTitle: string
}

/**
 * RationaleView — the **structured rationale**, always rendered as the source of
 * truth (narration sits alongside, never replacing it — A19). Three addressable
 * blocks mirroring the structured form: **factors** (what drives the score, as
 * magnitude bars), **constraints** (binding ones flagged), and **comparatives**
 * (why this option beats/loses the others). Pure presentation — the screen resolves
 * the i18n keys + params into these rows.
 */
export function RationaleView({ factors, constraints, comparatives, factorsTitle, constraintsTitle, comparativesTitle }: RationaleViewProps) {
  const max = factors.reduce((m, f) => Math.max(m, Math.abs(f.contribution)), 0)
  return (
    <YStack gap="$3.5">
      <YStack gap="$2.5">
        <P size={5} weight="b" caps color="$textTertiary">
          {factorsTitle}
        </P>
        {factors.map((f) => (
          <FactorBar key={f.label} {...f} max={max} />
        ))}
      </YStack>

      {constraints.length > 0 ? (
        <YStack gap="$2">
          <P size={5} weight="b" caps color="$textTertiary">
            {constraintsTitle}
          </P>
          {constraints.map((c) => (
            <XStack key={c.label} gap="$2" alignItems="center">
              {c.binding ? <TriangleAlert size={13} color="$warning" /> : <Check size={13} color="$success" />}
              <P size={4} color={c.binding ? '$textPrimary' : '$textSecondary'} weight={c.binding ? 'm' : 'r'}>
                {c.detail}
              </P>
            </XStack>
          ))}
        </YStack>
      ) : null}

      {comparatives.length > 0 ? (
        <YStack gap="$2">
          <P size={5} weight="b" caps color="$textTertiary">
            {comparativesTitle}
          </P>
          {comparatives.map((c, i) => (
            <P key={i} size={4} color="$textSecondary">
              {c.text}
            </P>
          ))}
        </YStack>
      ) : null}
    </YStack>
  )
}
