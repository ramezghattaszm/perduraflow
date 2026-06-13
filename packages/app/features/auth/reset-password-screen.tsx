'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import { AppButton, AppInput, H, Screen, YStack } from '@perduraflow/ui'
import { useResetPassword } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useTranslation, translateError } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'

export function ResetPasswordScreen({ email, code }: { email: string; code: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const reset = useResetPassword()
  const { showToast } = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const onSubmit = () => {
    if (password !== confirm) {
      showToast(t('common:passwordMismatch'), { type: 'error' })
      return
    }
    reset.mutate(
      { email, code, password },
      {
        onSuccess: () => router.replace('/login'),
        onError: (err) => showToast(translateError(getApiErrorCode(err)), { type: 'error' }),
      },
    )
  }

  return (
    <Screen justifyContent="center">
      <YStack gap="$4" width="100%" maxWidth={420} alignSelf="center">
        <H level={2}>{t('auth:resetPassword.title')}</H>
        <AppInput
          type="password"
          label={t('auth:resetPassword.password')}
          value={password}
          onChangeText={setPassword}
        />
        <AppInput
          type="password"
          label={t('auth:resetPassword.confirm')}
          value={confirm}
          onChangeText={setConfirm}
        />
        <AppButton onPress={onSubmit} loading={reset.isPending}>
          {t('auth:resetPassword.submit')}
        </AppButton>
      </YStack>
    </Screen>
  )
}
