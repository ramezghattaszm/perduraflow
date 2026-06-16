'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import { AppButton, AppInput, H, P, Screen, TextLink, XStack, YStack } from '@perduraflow/ui'
import { useRegister } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useTranslation, translateError } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'

export function RegisterScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const register = useRegister()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const onSubmit = () => {
    register.mutate(
      { name, email, password },
      {
        onSuccess: () =>
          router.push(`/verify-otp?email=${encodeURIComponent(email)}&type=registration`),
        onError: (err) => showToast(translateError(getApiErrorCode(err)), { type: 'error' }),
      },
    )
  }

  return (
    <Screen justifyContent="center">
      <YStack gap="$4" width="100%" maxWidth={420} alignSelf="center">
        <H level={1}>{t('auth:register.title')}</H>
        <AppInput label={t('auth:register.name')} value={name} onChangeText={setName} />
        <AppInput
          type="email"
          label={t('auth:register.email')}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
        />
        <AppInput
          type="password"
          label={t('auth:register.password')}
          value={password}
          onChangeText={setPassword}
        />
        <AppButton onPress={onSubmit} loading={register.isPending}>
          {t('auth:register.submit')}
        </AppButton>
        <XStack justifyContent="center" gap="$2">
          <P size={3} color="$textSecondary">
            {t('auth:register.haveAccount')}
          </P>
          <TextLink size={3} weight="b" onPress={() => router.push('/login')}>
            {t('auth:register.signIn')}
          </TextLink>
        </XStack>
      </YStack>
    </Screen>
  )
}
