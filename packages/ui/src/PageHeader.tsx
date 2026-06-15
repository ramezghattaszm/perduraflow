import type { ReactNode } from 'react'
import { XStack, YStack } from 'tamagui'
import { H, P } from './typography'

/**
 * Page header — a title (+ optional subtitle) on the left and an actions slot on
 * the right. Used at the top of every admin screen so headers never diverge.
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
  return (
    <XStack alignItems="flex-start" justifyContent="space-between" gap="$4">
      <YStack gap="$1" flex={1}>
        <H level={2} color="$textPrimary">
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
