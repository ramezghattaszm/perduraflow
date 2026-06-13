'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { OtpPurpose } from '@perduraflow/contracts'
import { VerifyOtpScreen } from '@perduraflow/app/features/auth/verify-otp-screen'

function VerifyOtpInner() {
  const params = useSearchParams()
  return (
    <VerifyOtpScreen
      email={params.get('email') ?? ''}
      type={(params.get('type') as OtpPurpose | null) ?? 'registration'}
    />
  )
}

export default function Page() {
  return (
    <Suspense>
      <VerifyOtpInner />
    </Suspense>
  )
}
