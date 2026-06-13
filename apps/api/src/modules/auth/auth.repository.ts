import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { DRIZZLE, type Database } from '../../db/drizzle.module'
import { otpCode, user, type OtpCode, type User } from '../../db/schema'
import type { OtpPurpose } from '@perduraflow/contracts'

@Injectable()
export class AuthRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findUserByEmail(email: string): Promise<User | undefined> {
    return this.db.query.user.findFirst({ where: eq(user.email, email) })
  }

  findUserById(id: string): Promise<User | undefined> {
    return this.db.query.user.findFirst({ where: eq(user.id, id) })
  }

  async createUser(data: {
    tenantId: string
    name: string
    email: string
    passwordHash: string
  }): Promise<User> {
    const [created] = await this.db.insert(user).values(data).returning()
    return created!
  }

  async setVerified(userId: string): Promise<void> {
    await this.db
      .update(user)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(eq(user.id, userId))
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(user)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(user.id, userId))
  }

  async createOtp(data: {
    target: string
    type: OtpPurpose
    codeHash: string
    expiresAt: Date
  }): Promise<void> {
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
