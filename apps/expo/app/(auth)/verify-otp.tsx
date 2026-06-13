import { useLocalSearchParams } from 'expo-router'
import type { OtpPurpose } from '@perduraflow/contracts'
import { VerifyOtpScreen } from '@perduraflow/app/features/auth/verify-otp-screen'

export default function VerifyOtp() {
  const { email, type } = useLocalSearchParams<{ email?: string; type?: OtpPurpose }>()
  return <VerifyOtpScreen email={email ?? ''} type={type ?? 'registration'} />
}
