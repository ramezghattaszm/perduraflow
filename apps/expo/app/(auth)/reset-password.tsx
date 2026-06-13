import { useLocalSearchParams } from 'expo-router'
import { ResetPasswordScreen } from '@perduraflow/app/features/auth/reset-password-screen'

export default function ResetPassword() {
  const { email, code } = useLocalSearchParams<{ email?: string; code?: string }>()
  return <ResetPasswordScreen email={email ?? ''} code={code ?? ''} />
}
