import type { ReactNode } from 'react'
import { YStack } from 'tamagui'
import { P } from './typography'

/**
 * Form field wrapper — a label, an arbitrary control slot, and an optional error
 * line. Use it to wrap non-text controls (SelectField, switches) so every field
 * in a form lines up identically. `AppInput` already self-labels; use FormField
 * for everything else.
 *
 * @example
 * <FormField label="Group type" error={err}><SelectField .../></FormField>
 */
export function FormField({
  label,
  error,
  required,
  children,
}: {
  label?: string
  error?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <YStack gap="$2" width="100%">
      {label ? (
        <P size={5} weight="m" color="$textSecondary">
          {label}
          {required ? ' *' : ''}
        </P>
      ) : null}
      {children}
      {error ? (
        <P size={5} color="$danger">
          {error}
        </P>
      ) : null}
    </YStack>
  )
}
