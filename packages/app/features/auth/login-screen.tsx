'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import { AppButton, AppInput, H, P, Screen, XStack, YStack } from '@perduraflow/ui'
import { useLogin } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useTranslation, translateError } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'

export function LoginScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const login = useLogin()
  const { showToast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const onSubmit = () => {
    login.mutate(
      { email, password },
      {
        onSuccess: () => router.replace('/'),
        onError: (err) => showToast(translateError(getApiErrorCode(err)), { type: 'error' }),
      },
    )
  }

  return (
    <Screen justifyContent="center">
      <YStack gap="$4" width="100%" maxWidth={420} alignSelf="center">
        <H level={1}>{t('auth:login.title')}</H>
        <P size={3} color="$textSecondary">
          {t('auth:login.subtitle')}
        </P>
        <AppInput
          type="email"
          label={t('auth:login.email')}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
        />
        <AppInput
          type="password"
          label={t('auth:login.password')}
          value={password}
          onChangeText={setPassword}
        />
        <AppButton onPress={onSubmit} loading={login.isPending}>
          {t('auth:login.submit')}
        </AppButton>
        <P size={4} weight="m" color="$primary" textAlign="center" onPress={() => router.push('/forgot-password')}>
          {t('auth:login.forgot')}
        </P>
        <XStack justifyContent="center" gap="$2">
          <P size={4} color="$textSecondary">
            {t('auth:login.noAccount')}
          </P>
          <P size={4} weight="b" color="$primary" onPress={() => router.push('/register')}>
            {t('auth:login.signUp')}
          </P>
        </XStack>
      </YStack>
    </Screen>
  )
}
