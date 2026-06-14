'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import { AppButton, AppInput, H, P, Screen, TextLink, XStack, YStack } from '@perduraflow/ui'
import { useLogin } from '../../hooks/useAuth'
import { useTranslation, translateError } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'

export function LoginScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // The error is shown inline below the form (persistent until the next submit),
  // so no transient toast here.
  const onSubmit = () => {
    login.mutate({ email, password }, { onSuccess: () => router.replace('/') })
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
        {login.isError ? (
          <P size={4} color="$danger">
            {translateError(getApiErrorCode(login.error))}
          </P>
        ) : null}
        <AppButton onPress={onSubmit} loading={login.isPending}>
          {t('auth:login.submit')}
        </AppButton>
        <TextLink size={4} weight="m" textAlign="center" onPress={() => router.push('/forgot-password')}>
          {t('auth:login.forgot')}
        </TextLink>
        <XStack justifyContent="center" gap="$2">
          <P size={4} color="$textSecondary">
            {t('auth:login.noAccount')}
          </P>
          <TextLink size={4} weight="b" onPress={() => router.push('/register')}>
            {t('auth:login.signUp')}
          </TextLink>
        </XStack>
      </YStack>
    </Screen>
  )
}
