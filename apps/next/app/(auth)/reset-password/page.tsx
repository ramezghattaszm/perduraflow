'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ResetPasswordScreen } from '@perduraflow/app/features/auth/reset-password-screen'

function ResetPasswordInner() {
  const params = useSearchParams()
  return <ResetPasswordScreen email={params.get('email') ?? ''} code={params.get('code') ?? ''} />
}

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  )
}
