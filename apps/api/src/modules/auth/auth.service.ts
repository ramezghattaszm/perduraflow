import { randomInt } from 'node:crypto'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import type {
  AdminUser,
  ApprovalTier as ApprovalTierDto,
  AuthResponse,
  AuthTokens,
  CreateRoleRequest,
  CreateUserRequest,
  ForgotPasswordRequest,
  LoginRequest,
  OrgReadContract,
  OtpPurpose,
  RegisterRequest,
  ResendOtpRequest,
  ResetPasswordRequest,
  Role as RoleDto,
  UpdateProfileRequest,
  UpdateRoleRequest,
  UpdateUserRequest,
  UserProfile,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from '@perduraflow/contracts'
import { env } from '../../config/env'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { EVENTS } from '../../events'
import { EventBus } from '../eventbus/event-bus'
import { ORG_READ } from '../org/org-read.service'
import { TenantService } from '../tenant/tenant.service'
import { NotifierService } from '../notifier/notifier.service'
import { AuthRepository } from './auth.repository'
import { toAdminUser, toApprovalTierDto, toRoleDto, toUserProfile } from './auth.mapper'
import type { NewUser, Role, User } from './schema'

const BCRYPT_ROUNDS = 10
const OTP_TTL_MS = 10 * 60 * 1000

/**
 * Authentication + identity (kernel). Owns registration/OTP, login, password
 * reset, token refresh, the caller's profile, and admin user/role CRUD. The
 * tenant is resolved at registration (TenantService) and embedded in the access
 * token; downstream queries scope by it. Role scope references (plants/groups)
 * are validated through the `org.read` contract (O4) — auth never touches org
 * tables.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly tenants: TenantService,
    private readonly notifier: NotifierService,
    private readonly events: EventBus,
    @Inject(ORG_READ) private readonly org: OrgReadContract,
  ) {}

  private async loadRole(u: User): Promise<Role | undefined> {
    return u.roleId ? this.repo.findRoleById(u.tenantId, u.roleId) : undefined
  }

  /** Build the private profile DTO, resolving the tenant brand for the shell. */
  private async profile(u: User, role: Role | undefined): Promise<UserProfile> {
    return toUserProfile(u, role, await this.tenants.getBrand(u.tenantId))
  }

  private async issueTokens(u: User, role: Role | undefined): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: u.id,
      email: u.email,
      tenantId: u.tenantId,
      roleId: u.roleId,
      roleName: role?.name ?? null,
      canConfigure: role?.canConfigure ?? false,
    }
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

  private async session(u: User): Promise<AuthResponse> {
    const role = await this.loadRole(u)
    return { ...(await this.issueTokens(u, role)), user: await this.profile(u, role) }
  }

  private async generateAndSendOtp(target: string, type: OtpPurpose): Promise<void> {
    const code = String(randomInt(100000, 1000000))
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS)
    await this.repo.createOtp({ target, type, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) })
    await this.notifier.sendOtp(target, code, type)
  }

  // --- auth flows ------------------------------------------------------------
  /**
   * Registers an unverified user, assigns the tenant, and sends a registration
   * OTP. Self-registered users get no role until an admin assigns one.
   *
   * Publishes `auth.user.registered` on the EventBus.
   * @throws AppException EMAIL_ALREADY_EXISTS - the email is already registered
   */
  async register(dto: RegisterRequest): Promise<{ email: string }> {
    if (await this.repo.findUserByEmail(dto.email)) {
      throw new AppException(HttpStatus.CONFLICT, 'Email already registered', ERROR_CODES.EMAIL_ALREADY_EXISTS)
    }
    const tenantId = await this.tenants.resolveTenantId(dto.email)
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
    const u = await this.repo.createUser({ tenantId, name: dto.name, email: dto.email, passwordHash })
    await this.events.publish(EVENTS.USER_REGISTERED, { userId: u.id, email: u.email, name: u.name }, tenantId)
    await this.generateAndSendOtp(dto.email, 'registration')
    return { email: u.email }
  }

  /**
   * Verifies credentials and issues a session.
   * @throws AppException INVALID_CREDENTIALS - unknown email or wrong password
   * @throws AppException EMAIL_NOT_VERIFIED - account exists but isn't verified
   */
  async login(dto: LoginRequest): Promise<AuthResponse> {
    const u = await this.repo.findUserByEmail(dto.email)
    if (!u || !(await bcrypt.compare(dto.password, u.passwordHash))) {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'Invalid email or password', ERROR_CODES.INVALID_CREDENTIALS)
    }
    if (!u.isVerified) {
      throw new AppException(HttpStatus.FORBIDDEN, 'Email not verified', ERROR_CODES.EMAIL_NOT_VERIFIED)
    }
    return this.session(u)
  }

  /**
   * Verifies an OTP. Registration verification marks the user verified and
   * returns a session; password-reset returns `{ verified: true }`.
   *
   * Publishes `auth.user.verified` on registration verification.
   * @throws AppException OTP_INVALID - code is wrong, expired, or already used
   * @throws AppException USER_NOT_FOUND - verified email has no user
   */
  async verifyOtp(dto: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    const otp = await this.repo.findValidOtp(dto.email, dto.type)
    if (!otp || !(await bcrypt.compare(dto.code, otp.codeHash))) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'Code is invalid or expired', ERROR_CODES.OTP_INVALID)
    }
    await this.repo.markOtpUsed(otp.id)

    if (dto.type === 'registration') {
      const u = await this.repo.findUserByEmail(dto.email)
      if (!u) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
      await this.repo.setVerified(u.id)
      await this.events.publish(EVENTS.USER_VERIFIED, { userId: u.id, email: u.email, name: u.name }, u.tenantId)
      return { verified: true, session: await this.session({ ...u, isVerified: true }) }
    }
    return { verified: true }
  }

  /** Re-issues an OTP if the email exists. Never reveals whether it does. */
  async resendOtp(dto: ResendOtpRequest): Promise<{ email: string }> {
    const u = await this.repo.findUserByEmail(dto.email)
    if (u) await this.generateAndSendOtp(dto.email, dto.type)
    return { email: dto.email }
  }

  /** Starts password reset by sending a reset OTP. Always succeeds (no enumeration). */
  async forgotPassword(dto: ForgotPasswordRequest): Promise<{ email: string }> {
    const u = await this.repo.findUserByEmail(dto.email)
    if (u) await this.generateAndSendOtp(dto.email, 'password_reset')
    return { email: dto.email }
  }

  /**
   * Sets a new password after a valid `password_reset` OTP.
   * @throws AppException OTP_INVALID - code is wrong, expired, or already used
   * @throws AppException USER_NOT_FOUND - no user for the email
   */
  async resetPassword(dto: ResetPasswordRequest): Promise<{ email: string }> {
    const otp = await this.repo.findValidOtp(dto.email, 'password_reset')
    if (!otp || !(await bcrypt.compare(dto.code, otp.codeHash))) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'Code is invalid or expired', ERROR_CODES.OTP_INVALID)
    }
    const u = await this.repo.findUserByEmail(dto.email)
    if (!u) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    await this.repo.markOtpUsed(otp.id)
    await this.repo.updatePassword(u.id, await bcrypt.hash(dto.password, BCRYPT_ROUNDS))
    return { email: u.email }
  }

  /**
   * Exchanges a valid refresh token for a fresh session.
   * @throws AppException INVALID_REFRESH_TOKEN - missing/invalid/expired token, or unknown user
   */
  async refresh(refreshToken: string | undefined): Promise<AuthResponse> {
    if (!refreshToken) {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'Missing refresh token', ERROR_CODES.INVALID_REFRESH_TOKEN)
    }
    let sub: string
    try {
      const decoded = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, { secret: env.JWT_REFRESH_SECRET })
      sub = decoded.sub
    } catch {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'Invalid refresh token', ERROR_CODES.INVALID_REFRESH_TOKEN)
    }
    const u = await this.repo.findUserById(sub)
    if (!u) throw new AppException(HttpStatus.UNAUTHORIZED, 'Invalid refresh token', ERROR_CODES.INVALID_REFRESH_TOKEN)
    return this.session(u)
  }

  // --- profile (/users/me) ---------------------------------------------------
  /**
   * Returns the caller's own profile.
   *
   * Ownership: `userId` is the caller's id from the JWT — only the caller's own
   * profile is ever returned.
   * @throws AppException USER_NOT_FOUND - no user for this id
   */
  async getMe(userId: string): Promise<UserProfile> {
    const u = await this.repo.findUserById(userId)
    if (!u) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    return this.profile(u, await this.loadRole(u))
  }

  /**
   * Updates the caller's own profile (name/avatar/UI preferences). Cross-user
   * updates are impossible by construction (no id param). Preferences are merged
   * onto the stored object so a partial patch never drops other keys.
   * @throws AppException USER_NOT_FOUND - no user for this id
   */
  async updateMe(userId: string, dto: UpdateProfileRequest): Promise<UserProfile> {
    const current = await this.repo.findUserById(userId)
    if (!current) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    const patch: Partial<NewUser> = {}
    if (dto.name !== undefined) patch.name = dto.name
    if (dto.avatarUrl !== undefined) patch.avatarUrl = dto.avatarUrl
    if (dto.preferences !== undefined) patch.preferences = { ...current.preferences, ...dto.preferences }
    const u = await this.repo.updateOwnProfile(userId, patch)
    if (!u) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    return this.profile(u, await this.loadRole(u))
  }

  // --- admin: users ----------------------------------------------------------
  /** Lists the tenant's users (admin). */
  async listUsers(tenantId: string): Promise<AdminUser[]> {
    const users = await this.repo.listUsers(tenantId)
    const roles = await this.repo.listRoles(tenantId)
    const byId = new Map(roles.map((r) => [r.id, r]))
    return users.map((u) => toAdminUser(u, u.roleId ? byId.get(u.roleId) : undefined))
  }

  /**
   * Creates a user (admin), optionally assigning a role in the same tenant.
   *
   * Publishes `auth.user.created`.
   * @throws AppException EMAIL_ALREADY_EXISTS - the email is taken
   * @throws AppException ROLE_NOT_FOUND - the assigned role is not in the tenant
   */
  async createUser(tenantId: string, dto: CreateUserRequest): Promise<AdminUser> {
    if (await this.repo.findUserByEmail(dto.email)) {
      throw new AppException(HttpStatus.CONFLICT, 'Email already registered', ERROR_CODES.EMAIL_ALREADY_EXISTS)
    }
    if (dto.roleId) await this.assertRole(tenantId, dto.roleId)
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
    const u = await this.repo.createUser({
      tenantId,
      name: dto.name,
      email: dto.email,
      passwordHash,
      roleId: dto.roleId,
      isVerified: dto.isVerified,
    })
    await this.events.publish(EVENTS.USER_CREATED, { userId: u.id, email: u.email, name: u.name }, tenantId)
    return toAdminUser(u, await this.loadRole(u))
  }

  /**
   * Updates a user (admin) in the tenant.
   * @throws AppException USER_NOT_FOUND - no such user in the tenant
   * @throws AppException ROLE_NOT_FOUND - the assigned role is not in the tenant
   */
  async updateUser(tenantId: string, id: string, dto: UpdateUserRequest): Promise<AdminUser> {
    if (dto.roleId) await this.assertRole(tenantId, dto.roleId)
    const u = await this.repo.updateUser(tenantId, id, dto)
    if (!u) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    return toAdminUser(u, await this.loadRole(u))
  }

  // --- admin: roles & tiers --------------------------------------------------
  /** Lists the tenant's roles (admin). */
  async listRoles(tenantId: string): Promise<RoleDto[]> {
    return (await this.repo.listRoles(tenantId)).map(toRoleDto)
  }

  /** Lists the tenant's approval tiers (admin). */
  async listApprovalTiers(tenantId: string): Promise<ApprovalTierDto[]> {
    return (await this.repo.listApprovalTiers(tenantId)).map(toApprovalTierDto)
  }

  /**
   * Creates a role (admin), validating its scope references through `org.read`
   * (O4) and its approval tier within the tenant.
   *
   * Publishes `auth.role.created`.
   * @throws AppException INVALID_PLANT_REFERENCE - a scoped plant/group id did not resolve via org.read
   * @throws AppException APPROVAL_TIER_NOT_FOUND - the approval tier is not in the tenant
   */
  async createRole(tenantId: string, dto: CreateRoleRequest): Promise<RoleDto> {
    await this.validateRoleRefs(tenantId, dto.scopedPlantIds, dto.scopedPlantGroupIds, dto.approvalTierId)
    const row = await this.repo.createRole({
      tenantId,
      name: dto.name,
      dataScope: dto.dataScope,
      scopedPlantIds: dto.scopedPlantIds,
      scopedPlantGroupIds: dto.scopedPlantGroupIds,
      approvalTierId: dto.approvalTierId,
      canConfigure: dto.canConfigure,
    })
    await this.events.publish(EVENTS.ROLE_CREATED, { id: row.id, tenantId, name: row.name }, tenantId)
    return toRoleDto(row)
  }

  /**
   * Updates a role (admin), re-validating any supplied scope references via
   * `org.read` (O4).
   * @throws AppException ROLE_NOT_FOUND - no such role in the tenant
   * @throws AppException INVALID_PLANT_REFERENCE - a scoped plant/group id did not resolve via org.read
   * @throws AppException APPROVAL_TIER_NOT_FOUND - the approval tier is not in the tenant
   */
  async updateRole(tenantId: string, id: string, dto: UpdateRoleRequest): Promise<RoleDto> {
    await this.validateRoleRefs(tenantId, dto.scopedPlantIds, dto.scopedPlantGroupIds, dto.approvalTierId)
    const row = await this.repo.updateRole(tenantId, id, dto)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'Role not found', ERROR_CODES.ROLE_NOT_FOUND)
    return toRoleDto(row)
  }

  // --- internal validation ---------------------------------------------------
  private async assertRole(tenantId: string, roleId: string): Promise<void> {
    if (!(await this.repo.findRoleById(tenantId, roleId))) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Role not found', ERROR_CODES.ROLE_NOT_FOUND)
    }
  }

  /** Validates a role's cross-module org references through the `org.read` contract (O4). */
  private async validateRoleRefs(
    tenantId: string,
    plantIds: string[] | undefined,
    groupIds: string[] | undefined,
    approvalTierId: string | null | undefined,
  ): Promise<void> {
    if (plantIds && plantIds.length > 0) {
      const { invalid } = await this.org.validatePlantIds(tenantId, plantIds)
      if (invalid.length > 0) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          `Unknown plant reference(s): ${invalid.join(', ')}`,
          ERROR_CODES.INVALID_PLANT_REFERENCE,
        )
      }
    }
    if (groupIds && groupIds.length > 0) {
      const { invalid } = await this.org.validatePlantGroupIds(tenantId, groupIds)
      if (invalid.length > 0) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          `Unknown plant-group reference(s): ${invalid.join(', ')}`,
          ERROR_CODES.INVALID_PLANT_REFERENCE,
        )
      }
    }
    if (approvalTierId) {
      if (!(await this.repo.findApprovalTier(tenantId, approvalTierId))) {
        throw new AppException(HttpStatus.NOT_FOUND, 'Approval tier not found', ERROR_CODES.APPROVAL_TIER_NOT_FOUND)
      }
    }
  }
}
