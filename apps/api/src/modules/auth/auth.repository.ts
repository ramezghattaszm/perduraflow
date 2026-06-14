import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import type { OtpPurpose } from '@perduraflow/contracts'
import { AUTH_DB, type AuthDatabase } from './auth.db'
import {
  approvalTier,
  otpCode,
  role,
  user,
  type ApprovalTier,
  type NewRole,
  type NewUser,
  type OtpCode,
  type Role,
  type User,
} from './schema'

/**
 * All Drizzle queries for the auth module (user, role, approval_tier, otp_code).
 * The `db` here is scoped to ONLY auth tables (O2). User/role/tier queries are
 * tenant-scoped where they are user-facing; otp is pre-auth (no tenant).
 */
@Injectable()
export class AuthRepository {
  constructor(@Inject(AUTH_DB) private readonly db: AuthDatabase) {}

  // --- user ------------------------------------------------------------------
  findUserByEmail(email: string): Promise<User | undefined> {
    return this.db.query.user.findFirst({ where: eq(user.email, email) })
  }

  findUserById(id: string): Promise<User | undefined> {
    return this.db.query.user.findFirst({ where: eq(user.id, id) })
  }

  listUsers(tenantId: string): Promise<User[]> {
    return this.db.select().from(user).where(eq(user.tenantId, tenantId)).orderBy(asc(user.name))
  }

  async createUser(data: NewUser): Promise<User> {
    const [created] = await this.db.insert(user).values(data).returning()
    return created!
  }

  async updateUser(tenantId: string, id: string, patch: Partial<NewUser>): Promise<User | undefined> {
    const [row] = await this.db
      .update(user)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(user.tenantId, tenantId), eq(user.id, id)))
      .returning()
    return row
  }

  async updateOwnProfile(id: string, patch: Partial<NewUser>): Promise<User | undefined> {
    const [row] = await this.db
      .update(user)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(user.id, id))
      .returning()
    return row
  }

  async setVerified(userId: string): Promise<void> {
    await this.db.update(user).set({ isVerified: true, updatedAt: new Date() }).where(eq(user.id, userId))
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.update(user).set({ passwordHash, updatedAt: new Date() }).where(eq(user.id, userId))
  }

  // --- role ------------------------------------------------------------------
  listRoles(tenantId: string): Promise<Role[]> {
    return this.db.select().from(role).where(eq(role.tenantId, tenantId)).orderBy(asc(role.name))
  }

  findRoleById(tenantId: string, id: string): Promise<Role | undefined> {
    return this.db.query.role.findFirst({ where: and(eq(role.tenantId, tenantId), eq(role.id, id)) })
  }

  async createRole(data: NewRole): Promise<Role> {
    const [row] = await this.db.insert(role).values(data).returning()
    return row!
  }

  async updateRole(tenantId: string, id: string, patch: Partial<NewRole>): Promise<Role | undefined> {
    const [row] = await this.db
      .update(role)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(role.tenantId, tenantId), eq(role.id, id)))
      .returning()
    return row
  }

  // --- approval tier ---------------------------------------------------------
  listApprovalTiers(tenantId: string): Promise<ApprovalTier[]> {
    return this.db
      .select()
      .from(approvalTier)
      .where(eq(approvalTier.tenantId, tenantId))
      .orderBy(asc(approvalTier.rank))
  }

  findApprovalTier(tenantId: string, id: string): Promise<ApprovalTier | undefined> {
    return this.db.query.approvalTier.findFirst({
      where: and(eq(approvalTier.tenantId, tenantId), eq(approvalTier.id, id)),
    })
  }

  // --- otp -------------------------------------------------------------------
  async createOtp(data: { target: string; type: OtpPurpose; codeHash: string; expiresAt: Date }): Promise<void> {
    await this.db.insert(otpCode).values(data)
  }

  findValidOtp(target: string, type: OtpPurpose): Promise<OtpCode | undefined> {
    return this.db.query.otpCode.findFirst({
      where: and(
        eq(otpCode.target, target),
        eq(otpCode.type, type),
        isNull(otpCode.usedAt),
        gt(otpCode.expiresAt, new Date()),
      ),
      orderBy: desc(otpCode.createdAt),
    })
  }

  async markOtpUsed(id: string): Promise<void> {
    await this.db.update(otpCode).set({ usedAt: new Date() }).where(eq(otpCode.id, id))
  }
}
