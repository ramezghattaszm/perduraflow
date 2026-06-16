'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import { AppButton, H, P, Screen, XStack, YStack } from '@perduraflow/ui'
import { useTranslation } from '../../i18n'

export function OnboardingScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const [index, setIndex] = useState(0)

  const slides = [
    { title: t('auth:onboarding.slide1Title'), body: t('auth:onboarding.slide1Body') },
    { title: t('auth:onboarding.slide2Title'), body: t('auth:onboarding.slide2Body') },
    { title: t('auth:onboarding.slide3Title'), body: t('auth:onboarding.slide3Body') },
  ]
  const isLast = index === slides.length - 1
  const slide = slides[index]!

  return (
    <Screen justifyContent="center">
      <YStack gap="$6" width="100%" maxWidth={460} alignSelf="center" flex={1} justifyContent="center">
        <YStack gap="$3">
          <H level="display">{slide.title}</H>
          <P size={2} color="$textSecondary">
            {slide.body}
          </P>
        </YStack>

        <XStack gap="$2" justifyContent="center">
          {slides.map((s, i) => (
            <YStack
              key={s.title}
              width={i === index ? 24 : 8}
              height={8}
              borderRadius={999}
              backgroundColor={i === index ? '$primary' : '$borderColor'}
            />
          ))}
        </XStack>

        <AppButton onPress={() => (isLast ? router.push('/register') : setIndex(index + 1))}>
          {isLast ? t('auth:onboarding.getStarted') : t('common:next')}
        </AppButton>
      </YStack>
    </Screen>
  )
}
