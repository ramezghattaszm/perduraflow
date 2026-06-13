import { HttpStatus, Injectable } from '@nestjs/common'
import type { UpdateProfileRequest, UserProfile } from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { toUserProfile } from '../../common/mappers/user.mapper'
import { UsersRepository } from './users.repository'

/**
 * Current-user profile reads/writes. Every operation is scoped to the caller's
 * own id (from the JWT) — there is no cross-user access surface here (§11).
 */
@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  /**
   * Returns the caller's own profile.
   *
   * Ownership: `userId` is the caller's id from the JWT (`@CurrentUser`); only
   * the caller's own profile is ever returned.
   *
   * @throws AppException USER_NOT_FOUND - no user exists for this id
   */
  async getMe(userId: string): Promise<UserProfile> {
    const u = await this.repo.findById(userId)
    if (!u) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    return toUserProfile(u)
  }

  /**
   * Updates the caller's own profile (name/avatar).
   *
   * Ownership: `userId` is the caller's id from the JWT; cross-user updates are
   * impossible by construction (no id param). Only provided fields are changed.
   *
   * @throws AppException USER_NOT_FOUND - no user exists for this id
   */
  async updateMe(userId: string, dto: UpdateProfileRequest): Promise<UserProfile> {
    const patch: Partial<{ name: string; avatarUrl: string | null }> = {}
    if (dto.name !== undefined) patch.name = dto.name
    if (dto.avatarUrl !== undefined) patch.avatarUrl = dto.avatarUrl
    const u = await this.repo.update(userId, patch)
    if (!u) throw new AppException(HttpStatus.NOT_FOUND, 'User not found', ERROR_CODES.USER_NOT_FOUND)
    return toUserProfile(u)
  }
}
