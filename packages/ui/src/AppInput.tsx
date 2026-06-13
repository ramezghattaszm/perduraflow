import { useState } from 'react'
import { Input, TextArea, XStack, YStack, styled, type GetProps } from 'tamagui'
import { P } from './typography'

/**
 * AppInput — labelled text field with error + variants. One component covers
 * text/email/password/multiline; password gets a show/hide toggle. Colors are
 * semantic tokens only.
 */
const Field = styled(Input, {
  name: 'AppInput',
  borderWidth: 1,
  borderColor: '$borderColor',
  backgroundColor: '$surface',
  color: '$textPrimary',
  placeholderTextColor: '$textSecondary',
  borderRadius: '$4',
  height: 48,
  paddingHorizontal: '$3',
  fontSize: 16,
  variants: {
    variant: {
      default: {},
      ghost: { backgroundColor: 'transparent', borderColor: '$surfaceGhost' },
      filled: { backgroundColor: '$background', borderColor: 'transparent' },
    },
    invalid: {
      true: { borderColor: '$danger' },
    },
  } as const,
  defaultVariants: { variant: 'default' },
})

type FieldProps = GetProps<typeof Field>
type InputType = 'text' | 'email' | 'password' | 'multiline'

export type AppInputProps = Omit<FieldProps, 'variant'> & {
  label?: string
  error?: string
  type?: InputType
  variant?: 'default' | 'ghost' | 'filled'
}

/**
 * Labelled text field with error + variants. One component covers
 * text/email/password (with show/hide)/multiline. Colors are semantic tokens.
 *
 * @example
 * <AppInput type="email" label="Email" value={email} onChangeText={setEmail} error={err} />
 */
export function AppInput({
  label,
  error,
  type = 'text',
  variant = 'default',
  ...props
}: AppInputProps) {
  const [hidden, setHidden] = useState(true)
  const invalid = Boolean(error)

  return (
    <YStack gap="$2" width="100%">
      {label ? (
        <P size={5} weight="m" color="$textSecondary">
          {label}
        </P>
      ) : null}

      {type === 'multiline' ? (
        <TextArea
          borderWidth={1}
          borderColor={invalid ? '$danger' : '$borderColor'}
          backgroundColor="$surface"
          color="$textPrimary"
          placeholderTextColor="$textSecondary"
          borderRadius="$4"
          minHeight={96}
          padding="$3"
          fontSize={16}
          {...(props as GetProps<typeof TextArea>)}
        />
      ) : type === 'password' ? (
        <XStack alignItems="center" position="relative">
          <Field
            variant={variant}
            invalid={invalid}
            flex={1}
            paddingRight="$7"
            secureTextEntry={hidden}
            autoCapitalize="none"
            {...props}
          />
          <P
            size={5}
            weight="m"
            color="$primary"
            position="absolute"
            right="$3"
            onPress={() => setHidden((h) => !h)}
          >
            {hidden ? 'Show' : 'Hide'}
          </P>
        </XStack>
      ) : (
        <Field
          variant={variant}
          invalid={invalid}
          keyboardType={type === 'email' ? 'email-address' : 'default'}
          autoCapitalize={type === 'email' ? 'none' : 'sentences'}
          {...props}
        />
      )}

      {error ? (
        <P size={5} color="$danger">
          {error}
        </P>
      ) : null}
    </YStack>
  )
}
