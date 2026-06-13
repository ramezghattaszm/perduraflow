import { z } from 'zod'
import type { UserProfile } from './user'

/** OTP delivery context — registration verification vs password reset. */
export const otpPurposeSchema = z.enum(['registration', 'password_reset'])
export type OtpPurpose = z.infer<typeof otpPurposeSchema>

export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
})
export type RegisterRequest = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof loginSchema>

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  type: otpPurposeSchema,
})
export type VerifyOtpRequest = z.infer<typeof verifyOtpSchema>

export const resendOtpSchema = z.object({
  email: z.string().email(),
  type: otpPurposeSchema,
})
export type ResendOtpRequest = z.infer<typeof resendOtpSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
})
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8).max(128),
})
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>

// Native sends the refresh token in the body; web omits it (httpOnly cookie).
export const refreshSchema = z.object({
  refreshToken: z.string().optional(),
})
export type RefreshRequest = z.infer<typeof refreshSchema>

/** Tokens issued by login/refresh. `refreshToken` only present on native. */
export interface AuthTokens {
  accessToken: string
  refreshToken?: string
}

/** Login / refresh response: access token (+ native refresh token) and the user. */
export interface AuthResponse extends AuthTokens {
  user: UserProfile
}

/** verify-otp result: registration verification returns a session; reset does not. */
export interface VerifyOtpResponse {
  verified: boolean
  session?: AuthResponse
}
