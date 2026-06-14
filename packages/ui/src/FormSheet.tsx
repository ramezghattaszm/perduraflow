import type { ReactNode } from 'react'
import { ScrollView, XStack, YStack } from 'tamagui'
import { AppButton } from './AppButton'
import { H, P } from './typography'

/**
 * FormSheet — a centered modal panel for create/edit forms (the frontend-spec's
 * "FormSheet modal over the list"). Rendered as an in-app overlay (no portal
 * dependency) so it behaves identically on web and native; on web/tablet this is
 * the authoring surface. When `open` is false it renders nothing.
 *
 * @example
 * <FormSheet open={open} title="New plant" submitting={m.isPending} onSubmit={save} onCancel={close}>
 *   <AppInput label="Name" .../>
 * </FormSheet>
 */
export function FormSheet({
  open,
  title,
  children,
  onSubmit,
  onCancel,
  submitting,
  error,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
}: {
  open: boolean
  title: string
  children: ReactNode
  onSubmit: () => void
  onCancel: () => void
  submitting?: boolean
  /** Server/validation error message shown above the footer (e.g. a rejected contract ref). */
  error?: string
  submitLabel?: string
  cancelLabel?: string
}) {
  if (!open) return null
  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={1000}
      alignItems="center"
      justifyContent="center"
      padding="$4"
      backgroundColor="$overlay"
    >
      <YStack
        width="100%"
        maxWidth={520}
        maxHeight="90%"
        backgroundColor="$surface"
        borderRadius="$6"
        borderWidth={1}
        borderColor="$borderColor"
        overflow="hidden"
      >
        <YStack padding="$5" borderBottomWidth={1} borderBottomColor="$borderColor">
          <H level={4} color="$textPrimary">
            {title}
          </H>
        </YStack>
        <ScrollView>
          <YStack padding="$5" gap="$4">
            {children}
          </YStack>
        </ScrollView>
        {error ? (
          <YStack paddingHorizontal="$5" paddingBottom="$2">
            <P size={5} color="$danger">
              {error}
            </P>
          </YStack>
        ) : null}
        <XStack
          padding="$4"
          gap="$3"
          justifyContent="flex-end"
          borderTopWidth={1}
          borderTopColor="$borderColor"
        >
          <AppButton variant="light" size="$3" onPress={onCancel}>
            {cancelLabel}
          </AppButton>
          <AppButton variant="primary" size="$3" loading={submitting} onPress={onSubmit}>
            {submitLabel}
          </AppButton>
        </XStack>
      </YStack>
    </YStack>
  )
}
