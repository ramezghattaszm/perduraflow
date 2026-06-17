import { Sparkles } from '@tamagui/lucide-icons'
import { Spinner, XStack, YStack } from 'tamagui'
import { P } from './typography'

/** Narration render state — async, never blocking the decision. */
export type NarrationState = 'idle' | 'loading' | 'ready' | 'unavailable'

/** Props for {@link NarrationBlock}. */
export interface NarrationBlockProps {
  state: NarrationState
  /** The prose (when `ready`). */
  prose?: string | null
  title: string
  loadingText: string
  unavailableText: string
  /** Small "translation only" provenance note (when ready). */
  note?: string
}

/**
 * NarrationBlock — the **translate-only** prose (A19), rendered **alongside** the
 * structured rationale, never replacing it. Async + non-blocking: it shows a spinner
 * while writing, the prose when ready, and an honest "unavailable" line on failure —
 * with **zero functional impact** (the rationale above remains the answer). It adds
 * no fact of its own; it only re-voices the structured rationale.
 */
export function NarrationBlock({ state, prose, title, loadingText, unavailableText, note }: NarrationBlockProps) {
  if (state === 'idle') return null
  return (
    <YStack gap="$2" backgroundColor="$mlSoft" borderRadius="$4" padding="$3">
      <XStack gap="$2" alignItems="center">
        <Sparkles size={13} color="$ml" />
        <P size={5} weight="b" caps color="$ml">
          {title}
        </P>
      </XStack>
      {state === 'loading' ? (
        <XStack gap="$2" alignItems="center">
          <Spinner size="small" color="$ml" />
          <P size={4} color="$textSecondary">
            {loadingText}
          </P>
        </XStack>
      ) : null}
      {state === 'ready' ? (
        <YStack gap="$1.5">
          <P size={3} color="$textPrimary">
            {prose}
          </P>
          {note ? (
            <P size={5} color="$textTertiary">
              {note}
            </P>
          ) : null}
        </YStack>
      ) : null}
      {state === 'unavailable' ? (
        <P size={4} color="$textSecondary">
          {unavailableText}
        </P>
      ) : null}
    </YStack>
  )
}
