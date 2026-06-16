'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import type { OtpPurpose } from '@perduraflow/contracts'
import { AppButton, H, OtpInput, P, Screen, YStack } from '@perduraflow/ui'
import { useResendOtp, useVerifyOtp } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useTranslation, translateError } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'

export function VerifyOtpScreen({ email, type }: { email: string; type: OtpPurpose }) {
  const { t } = useTranslation()
  const router = useRouter()
  const verify = useVerifyOtp()
  const resend = useResendOtp()
  const { showToast } = useToast()
  const [code, setCode] = useState('')

  const onSubmit = () => {
    verify.mutate(
      { email, code, type },
      {
        onSuccess: () => {
          if (type === 'registration') router.replace('/')
          else router.replace(`/reset-password?email=${encodeURIComponent(email)}&code=${code}`)
        },
        onError: (err) => showToast(translateError(getApiErrorCode(err)), { type: 'error' }),
      },
    )
  }

  return (
    <Screen justifyContent="center">
      <YStack gap="$5" width="100%" maxWidth={420} alignSelf="center">
        <YStack gap="$2">
          <H level={2}>{t('auth:verifyOtp.title')}</H>
          <P size={3} color="$textSecondary">
            {t('auth:verifyOtp.subtitle', { email })}
          </P>
        </YStack>
        <OtpInput value={code} onChange={setCode} />
        <AppButton onPress={onSubmit} loading={verify.isPending} disabled={code.length < 6}>
          {t('auth:verifyOtp.submit')}
        </AppButton>
        <P
          size={3}
          weight="b"
          color="$primary"
          textAlign="center"
          onPress={() => resend.mutate({ email, type })}
        >
          {t('auth:verifyOtp.resend')}
        </P>
      </YStack>
    </Screen>
  )
}
