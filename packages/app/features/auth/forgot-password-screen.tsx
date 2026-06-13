'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import { AppButton, AppInput, H, P, Screen, YStack } from '@perduraflow/ui'
import { useForgotPassword } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useTranslation, translateError } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'

export function ForgotPasswordScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const forgot = useForgotPassword()
  const { showToast } = useToast()
  const [email, setEmail] = useState('')

  const onSubmit = () => {
    forgot.mutate(
      { email },
      {
        onSuccess: () =>
          router.push(`/verify-otp?email=${encodeURIComponent(email)}&type=password_reset`),
        onError: (err) => showToast(translateError(getApiErrorCode(err)), { type: 'error' }),
      },
    )
  }

  return (
    <Screen justifyContent="center">
      <YStack gap="$4" width="100%" maxWidth={420} alignSelf="center">
        <H level={2}>{t('auth:forgotPassword.title')}</H>
        <P size={3} color="$textSecondary">
          {t('auth:forgotPassword.subtitle')}
        </P>
        <AppInput
          type="email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
        />
        <AppButton onPress={onSubmit} loading={forgot.isPending}>
          {t('auth:forgotPassword.submit')}
        </AppButton>
      </YStack>
    </Screen>
  )
}
