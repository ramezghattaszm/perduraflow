import { useState } from 'react'
import { GitBranch } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { AppButton } from './AppButton'
import { P } from './typography'

/** Props for {@link LatenessChain}. */
export interface LatenessChainProps {
  /** Section heading, e.g. "Why late". */
  title: string
  /** Concise one-liner: root cause + immediate blocker (always shown). */
  summary: string
  /** Full chain, one line per hop (late op → blocker → … → root). Shown when expanded. */
  lines: string[]
  /** Toggle labels. */
  expandLabel: string
  collapseLabel: string
}

/**
 * LatenessChain — renders an order's **computed causal lateness chain** (D-late): a one-line summary
 * (root cause + immediate blocker) with an expander revealing the full hop-by-hop chain down to the
 * root. Presentational only — the parent passes already-translated strings derived from the grounded
 * chain (the same chain the exception queue and Copilot read). Shown only for at-risk operations.
 */
export function LatenessChain({ title, summary, lines, expandLabel, collapseLabel }: LatenessChainProps) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = lines.length > 1
  return (
    <YStack gap="$1.5" padding="$2.5" backgroundColor="$dangerSoft" borderRadius="$3">
      <XStack gap="$1.5" alignItems="center">
        <GitBranch size={13} color="$danger" />
        <P size={5} weight="b" color="$danger">
          {title}
        </P>
      </XStack>
      {expanded ? (
        <YStack gap="$1">
          {lines.map((line, i) => (
            <P key={i} size={4} color="$textSecondary">
              {line}
            </P>
          ))}
        </YStack>
      ) : (
        <P size={4} color="$textSecondary">
          {summary}
        </P>
      )}
      {canExpand ? (
        <XStack>
          <AppButton variant="ghost" size="$3" onPress={() => setExpanded((v) => !v)}>
            {expanded ? collapseLabel : expandLabel}
          </AppButton>
        </XStack>
      ) : null}
    </YStack>
  )
}
