import type { ReactNode } from 'react'
import { useMedia, XStack, YStack } from 'tamagui'
import { H, P } from './typography'

/**
 * Page header — a title (+ optional subtitle) on the left and an actions slot on
 * the right. Used at the top of every screen so headers never diverge.
 *
 * **Responsive density (PHASE-3-POLISH item 1):** on `small` the H1 + subtitle are
 * dropped (the screen title lives in the TopBar there, via AppShell `title`) and
 * only `actions` render, compact + right-aligned — so phone screens open on content.
 * Desktop is unchanged.
 *
 * @example
 * <PageHeader title="Plants" subtitle="Producing sites" actions={<AppButton>New</AppButton>} />
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  const small = Boolean(useMedia()['max-md'])
  if (small) {
    return actions ? (
      <XStack gap="$2" justifyContent="flex-end" flexWrap="wrap">
        {actions}
      </XStack>
    ) : null
  }
  return (
    <XStack alignItems="flex-start" justifyContent="space-between" gap="$4">
      <YStack gap="$1" flex={1}>
        <H level={1} color="$textPrimary">
          {title}
        </H>
        {subtitle ? (
          <P size={3} color="$textSecondary">
            {subtitle}
          </P>
        ) : null}
      </YStack>
      {actions ? <XStack gap="$2">{actions}</XStack> : null}
    </XStack>
  )
}
