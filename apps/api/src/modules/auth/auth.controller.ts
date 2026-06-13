import { Body, Controller, Delete, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  type AuthResponse,
  type ForgotPasswordRequest,
  forgotPasswordSchema,
  type LoginRequest,
  loginSchema,
  type RefreshRequest,
  refreshSchema,
  type RegisterRequest,
  registerSchema,
  type ResendOtpRequest,
  resendOtpSchema,
  type ResetPasswordRequest,
  resetPasswordSchema,
  type VerifyOtpRequest,
  verifyOtpSchema,
} from '@perduraflow/contracts'
import { env } from '../../config/env'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { AuthService } from './auth.service'

// httpOnly refresh cookie (web). Native sends/receives the token in the body.
const REFRESH_COOKIE = 'perduraflow_refresh'
const REFRESH_COOKIE_PATH = '/api/v1/auth'
const REFRESH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Public `/auth` routes (no JwtAuthGuard). Web receives the refresh token as an
 * httpOnly cookie (set via `setRefreshCookie`); native receives it in the body.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** `POST /auth/register` — create an unverified account; sends a verification OTP. */
  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterRequest) {
    return this.auth.register(dto)
  }

  /** `POST /auth/login` — issue tokens; sets the refresh cookie on web. */
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.setRefreshCookie(await this.auth.login(dto), res)
  }

  /** `POST /auth/verify-otp` — verify the OTP; on registration, sets the refresh cookie. */
  @Post('verify-otp')
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) dto: VerifyOtpRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyOtp(dto)
    if (result.session) this.setRefreshCookie(result.session, res)
    return result
  }

  /** `POST /auth/resend-otp` — re-send a verification/reset OTP. */
  @Post('resend-otp')
  resendOtp(@Body(new ZodValidationPipe(resendOtpSchema)) dto: ResendOtpRequest) {
    return this.auth.resendOtp(dto)
  }

  /** `POST /auth/forgot-password` — send a password-reset OTP (always 200). */
  @Post('forgot-password')
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordRequest) {
    return this.auth.forgotPassword(dto)
  }

  /** `POST /auth/reset-password` — set a new password using a verified reset OTP. */
  @Post('reset-password')
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordRequest) {
    return this.auth.resetPassword(dto)
  }

  /** `POST /auth/refresh` — rotate tokens using the refresh cookie (web) or body token (native). */
  @Post('refresh')
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined)
    return this.setRefreshCookie(await this.auth.refresh(token), res)
  }

  /** `DELETE /auth/logout` — clear the refresh cookie. */
  @Delete('logout')
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH })
    return { success: true }
  }

  private setRefreshCookie(session: AuthResponse, res: Response): AuthResponse {
    if (session.refreshToken) {
      res.cookie(REFRESH_COOKIE, session.refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: REFRESH_COOKIE_PATH,
        maxAge: REFRESH_MAX_AGE_MS,
      })
    }
    return session
  }
}
