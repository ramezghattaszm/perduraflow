import { useMutation } from '@tanstack/react-query'
import type {
  AuthResponse,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResendOtpRequest,
  ResetPasswordRequest,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { clearRefreshToken, setRefreshToken } from '../lib/refresh-store'
import { getTokenStore } from '../lib/token-store'
import { useAuthActions } from '../stores/auth.store'

async function applySession(session: AuthResponse, setAuth: (u: AuthResponse['user']) => void) {
  getTokenStore().setAccessToken(session.accessToken)
  if (session.refreshToken) await setRefreshToken(session.refreshToken)
  setAuth(session.user)
}

/** Registers a new account. Side effect: the API sends a verification OTP. Returns `{ email }`. */
export function useRegister() {
  return useMutation({
    mutationFn: (body: RegisterRequest) =>
      apiClient.post<{ email: string }>('/auth/register', body).then((r) => r.data),
  })
}

/** Logs in. On success: stores access/refresh tokens and sets the auth store user. */
export function useLogin() {
  const { setAuth } = useAuthActions()
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      apiClient.post<AuthResponse>('/auth/login', body).then((r) => r.data),
    onSuccess: (data) => applySession(data, setAuth),
  })
}

/** Verifies an OTP. For `registration` it establishes a session (stores tokens + user). */
export function useVerifyOtp() {
  const { setAuth } = useAuthActions()
  return useMutation({
    mutationFn: (body: VerifyOtpRequest) =>
      apiClient.post<VerifyOtpResponse>('/auth/verify-otp', body).then((r) => r.data),
    onSuccess: (data) => {
      if (data.session) return applySession(data.session, setAuth)
    },
  })
}

/** Re-sends a verification/reset OTP to the email. */
export function useResendOtp() {
  return useMutation({
    mutationFn: (body: ResendOtpRequest) =>
      apiClient.post('/auth/resend-otp', body).then((r) => r.data),
  })
}

/** Starts password reset. Side effect: the API sends a reset OTP (always 200; no account enumeration). */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: ForgotPasswordRequest) =>
      apiClient.post('/auth/forgot-password', body).then((r) => r.data),
  })
}

/** Completes password reset using the verified OTP + new password. */
export function useResetPassword() {
  return useMutation({
    mutationFn: (body: ResetPasswordRequest) =>
      apiClient.post('/auth/reset-password', body).then((r) => r.data),
  })
}

/** Logs out. Clears the access + refresh tokens, the auth store, and the query cache. */
export function useLogout() {
  const { logout } = useAuthActions()
  return useMutation({
    mutationFn: () => apiClient.delete('/auth/logout').then((r) => r.data),
    onSuccess: async () => {
      getTokenStore().clearAccessToken()
      await clearRefreshToken()
      logout()
      queryClient.clear()
    },
  })
}
