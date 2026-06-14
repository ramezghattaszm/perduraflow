import { useRef } from 'react'
import type { TextInput } from 'react-native'
import { Input, XStack, styled } from 'tamagui'

/**
 * OtpInput — fixed-length one-char-per-box code entry. Fires `onChange` on every
 * keystroke (no auto-submit; the screen owns the verify action). Backspace on an
 * empty box moves focus left.
 */
const Box = styled(Input, {
  name: 'OtpInput',
  width: 48,
  height: 56,
  borderWidth: 1,
  borderColor: '$borderColor',
  backgroundColor: '$surface',
  color: '$textPrimary',
  borderRadius: '$4',
  textAlign: 'center',
  fontSize: '$9', // 22px via the font size-token scale (fonts.ts)
  variants: {
    variant: {
      default: {},
      ghost: { backgroundColor: 'transparent', borderColor: '$surfaceGhost' },
    },
    filled: {
      true: { borderColor: '$primary' },
    },
  } as const,
  defaultVariants: { variant: 'default' },
})

export interface OtpInputProps {
  value: string
  onChange: (next: string) => void
  length?: number
  variant?: 'default' | 'ghost'
}

/**
 * Fixed-length one-char-per-box code entry. Fires `onChange` on every keystroke
 * (no auto-submit — the screen owns the verify action); backspace on an empty
 * box moves focus left.
 *
 * @example
 * <OtpInput value={code} onChange={setCode} length={6} />
 */
export function OtpInput({ value, onChange, length = 6, variant = 'default' }: OtpInputProps) {
  const refs = useRef<Array<TextInput | null>>([])
  const chars = Array.from({ length }, (_, i) => value[i] ?? '')

  const setChar = (i: number, raw: string) => {
    const ch = raw.replace(/\D/g, '').slice(-1)
    const next = chars.slice()
    next[i] = ch
    onChange(next.join('').slice(0, length))
    if (ch && i < length - 1) refs.current[i + 1]?.focus()
  }

  return (
    <XStack gap="$2" justifyContent="center">
      {chars.map((c, i) => (
        <Box
          key={i}
          ref={(el) => {
            refs.current[i] = el as unknown as TextInput | null
          }}
          variant={variant}
          filled={Boolean(c)}
          value={c}
          keyboardType="number-pad"
          maxLength={1}
          onChangeText={(t: string) => setChar(i, t)}
          onKeyPress={(e: { nativeEvent: { key: string } }) => {
            if (e.nativeEvent.key === 'Backspace' && !chars[i] && i > 0) {
              refs.current[i - 1]?.focus()
            }
          }}
        />
      ))}
    </XStack>
  )
}
