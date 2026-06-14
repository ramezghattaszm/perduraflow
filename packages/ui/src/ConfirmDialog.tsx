import { Portal, YStack } from 'tamagui'
import { AppButton } from './AppButton'
import { H, P } from './typography'

/**
 * ConfirmDialog — a small Portal-rendered confirmation modal for
 * destructive/irreversible actions; `tone` colors the confirm button.
 *
 * @remarks Superseded by `Popup` + `usePopup` for confirmations (UI §17); kept
 * as a standalone primitive. Prefer `usePopup().show({ buttons: [...] })`.
 *
 * @example
 * <ConfirmDialog open={open} title="Deactivate plant?" message="It will be hidden." tone="danger"
 *   onConfirm={deactivate} onCancel={close} />
 */
export function ConfirmDialog({
  open,
  title,
  message,
  tone = 'primary',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  submitting,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  tone?: 'primary' | 'danger'
  confirmLabel?: string
  cancelLabel?: string
  submitting?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <Portal>
      <YStack
        position="fixed"
        top={0}
        left={0}
        right={0}
        bottom={0}
        zIndex={1100}
        alignItems="center"
        justifyContent="center"
        padding="$4"
        backgroundColor="$overlay"
      >
        <YStack
          width="100%"
          maxWidth={420}
        backgroundColor="$surface"
        borderRadius="$6"
        borderWidth={1}
        borderColor="$borderColor"
        padding="$5"
        gap="$3"
      >
        <H level={5} color="$textPrimary">
          {title}
        </H>
        {message ? (
          <P size={4} color="$textSecondary">
            {message}
          </P>
        ) : null}
        <YStack gap="$3" marginTop="$2" flexDirection="row" justifyContent="flex-end">
          <AppButton variant="light" size="$3" onPress={onCancel}>
            {cancelLabel}
          </AppButton>
          <AppButton variant={tone} size="$3" loading={submitting} onPress={onConfirm}>
            {confirmLabel}
          </AppButton>
        </YStack>
        </YStack>
      </YStack>
    </Portal>
  )
}
