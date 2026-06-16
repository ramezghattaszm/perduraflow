import { Text, YStack } from 'tamagui'
import { H, P } from './typography'
import { AppButton } from './AppButton'

/**
 * EmptyState — centered icon/emoji + title + subtitle + optional action.
 * Used for empty lists, errors, and zero-data screens.
 */
export interface EmptyStateProps {
  icon?: string
  title: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
}

/**
 * Centered placeholder for empty lists / zero-data / error states: icon + title
 * + subtitle + optional action button.
 *
 * @example
 * <EmptyState icon="📭" title="No items yet" subtitle="Create your first one" actionLabel="New" onAction={create} />
 */
export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$6">
      {icon ? <Text fontSize={48}>{icon}</Text> : null}
      <H level={4} textAlign="center">
        {title}
      </H>
      {subtitle ? (
        <P size={3} color="$textSecondary" textAlign="center">
          {subtitle}
        </P>
      ) : null}
      {actionLabel && onAction ? (
        <YStack marginTop="$2">
          <AppButton variant="primary" onPress={onAction}>
            {actionLabel}
          </AppButton>
        </YStack>
      ) : null}
    </YStack>
  )
}
