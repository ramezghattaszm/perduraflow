import { randomInt } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import type {
  AuthResponse,
  AuthTokens,
  ForgotPasswordRequest,
  LoginRequest,
  OtpPurpose,
  RegisterRequest,
  ResendOtpRequest,
  ResetPasswordRequest,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from '@perduraflow/contracts'
import { env } from '../../config/env'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { toUserProfile } from '../../common/mappers/user.mapper'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { EVENTS } from '../../events'
import type { User } from '../../db/schema'
import { TenantService } from '../../tenant/tenant.service'
import { NotifierService } from '../notifier/notifier.service'
import { AuthRepository } from './auth.repository'

const BCRYPT_ROUNDS = 10
const OTP_TTL_MS = 10 * 60 * 1000

/**
 * Authentication: registration + OTP verification, login, password reset, and
 * token refresh. The tenant is resolved at registration (TenantService) and
 * embedded in the access token; downstream queries scope by it.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly tenants: TenantService,
    private readonly notifier: NotifierService,
    private readonly events: EventEmitter2,
  ) {}

  private async issueTokens(u: User): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: u.id, email: u.email, role: u.role, tenantId: u.tenantId }
    const accessToken = await this.jwt.signAsync(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    })
    const refreshToken = await this.jwt.signAsync(
      { sub: u.id },
      { secret: env.JWT_REFRESH_SECRET, expiresIn: env.JWT_REFRESH_EXPIRES_IN },
    )
    return { accessToken, refreshToken }
  }

  private async generateAndSendOtp(target: string, type: OtpPurpose): Promise<void> {
    const code = String(randomInt(100000, 1000000))
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS)
    await this.repo.createOtp({ target, type, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) })
    await this.notifier.sendOtp(target, code, type)
  }

  // --- flows -----------------------------------------------------------------
  /**
   * Registers an unverified user, assigns the tenant (TenantService), and sends
   * a registration OTP. The account cannot log in until verified.
   *
   * Emits `user.registered`.
   * @throws AppException EMAIL_ALREADY_EXISTS - the email is already registered
   */
  async register(dto: RegisterRequest): Promise<{ email: string }> {
    const existing = await this.repo.findUserByEmail(dto.email)
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'Email already registered',
        ERROR_CODES.EMAIL_ALREADY_EXISTS,
      )
    }
    const tenantId = await this.tenants.resolveTenantId(dto.email)
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
    const u = await this.repo.createUser({
      tenantId,
      name: dto.name,
      email: dto.email,
      passwordHash,
    })
    this.events.emit(EVENTS.USER_REGISTERED, { userId: u.id, email: u.email, name: u.name })
    await this.generateAndSendOtp(dto.email, 'registration')
    return { email: u.email }
  }

  /**
   * Verifies credentials and issues access + refresh tokens with the user profile.
   *
   * @throws AppException INVALID_CREDENTIALS - unknown email or wrong password
   * @throws AppException EMAIL_NOT_VERIFIED - account exists but isn't verified
   */
  async login(dto: LoginRequest): Promise<AuthResponse> {
    const u = await this.repo.findUserByEmail(dto.email)
    if (!u || !(await bcrypt.compare(dto.password, u.passwordHash))) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'Invalid email or password',
        ERROR_CODES.INVALID_CREDENTIALS,
      )
    }
    if (!u.isVerified) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'Email not verified',
        ERROR_CODES.EMAIL_NOT_VERIFIED,
      )
    }
    return { ...(await this.issueTokens(u)), user: toUserProfile(u) }
  }

  /**
   * Verifies an OTP. For `registration` it marks the user verified and returns a
   * session (tokens + user); for `password_reset` it returns `{ verified: true }`
   * and the client proceeds to reset-password.
   *
   * Emits `user.verified` on registration verification.
   * @throws AppException OTP_INVALID - code is wrong, expired, or already used
   * @throws AppException USER_NOT_FOUND - verified email has no user
   */
  async verifyOtp(dto: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    const otp = await this.repo.findValidOtp(dto.email, dto.type)
    if (!otp || !(await bcrypt.compare(dto.code, otp.codeHash))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'Code is invalid or expired',
        ERROR_CODES.OTP_INVALID,
      )
    }
    await this.repo.markOtpUsed(otp.id)

    if (dto.type === 'registration') {
      const u = await this.repo.findUserByEmail(dto.email)
      if (!u) {
        throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
      }
      await this.repo.setVerified(u.id)
      const verified: User = { ...u, isVerified: true }
      this.events.emit(EVENTS.USER_VERIFIED, { userId: u.id, email: u.email, name: u.name })
      return { verified: true, session: { ...(await this.issueTokens(verified)), user: toUserProfile(verified) } }
    }

    // password_reset: code accepted; client proceeds to reset-password.
    return { verified: true }
  }

  /** Re-issues an OTP if the email exists. Never reveals whether it does (no enumeration). */
  async resendOtp(dto: ResendOtpRequest): Promise<{ email: string }> {
    // Do not leak whether the email exists.
    const u = await this.repo.findUserByEmail(dto.email)
    if (u) await this.generateAndSendOtp(dto.email, dto.type)
    return { email: dto.email }
  }

  /** Starts password reset by sending a reset OTP. Always succeeds (no account enumeration). */
  async forgotPassword(dto: ForgotPasswordRequest): Promise<{ email: string }> {
    const u = await this.repo.findUserByEmail(dto.email)
    if (u) await this.generateAndSendOtp(dto.email, 'password_reset')
    return { email: dto.email }
  }

  /**
   * Sets a new password after a valid `password_reset` OTP.
   *
   * @throws AppException OTP_INVALID - code is wrong, expired, or already used
   * @throws AppException USER_NOT_FOUND - no user for the email
   */
  async resetPassword(dto: ResetPasswordRequest): Promise<{ email: string }> {
    const otp = await this.repo.findValidOtp(dto.email, 'password_reset')
    if (!otp || !(await bcrypt.compare(dto.code, otp.codeHash))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'Code is invalid or expired',
        ERROR_CODES.OTP_INVALID,
      )
    }
    const u = await this.repo.findUserByEmail(dto.email)
    if (!u) {
      throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    }
    await this.repo.markOtpUsed(otp.id)
    await this.repo.updatePassword(u.id, await bcrypt.hash(dto.password, BCRYPT_ROUNDS))
    return { email: u.email }
  }

  /**
   * Exchanges a valid refresh token for a fresh access + refresh token pair and
   * the current user.
   *
   * @throws AppException INVALID_REFRESH_TOKEN - missing/invalid/expired token, or unknown user
   */
  async refresh(refreshToken: string | undefined): Promise<AuthResponse> {
    if (!refreshToken) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'Missing refresh token',
        ERROR_CODES.INVALID_REFRESH_TOKEN,
      )
    }
    let sub: string
    try {
      const decoded = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, {
        secret: env.JWT_REFRESH_SECRET,
      })
      sub = decoded.sub
    } catch {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'Invalid refresh token',
        ERROR_CODES.INVALID_REFRESH_TOKEN,
      )
    }
    const u = await this.repo.findUserById(sub)
    if (!u) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'Invalid refresh token',
        ERROR_CODES.INVALID_REFRESH_TOKEN,
      )
    }
    return { ...(await this.issueTokens(u)), user: toUserProfile(u) }
  }
}
