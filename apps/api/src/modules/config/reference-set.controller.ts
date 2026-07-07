import { Body, Controller, Get, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ERROR_CODES, type SetReferenceMemberRequest, setReferenceMemberSchema } from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AppException } from '../../common/exceptions/app.exception'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { ReferenceReadService } from './reference-read.service'
import { ReferenceSetService } from './reference-set.service'

/**
 * Configurable reference-set admin (`/reference-sets/*`) — mirrors {@link ConfigController}. `GET` is any
 * authenticated user (read the resolved set / list registered sets); member mutations (add / override /
 * suppress / restore) are ConfigureGuard — member changes are stated, audited taxonomy changes. The stored
 * tenantId is always the caller's; a tenant-level scope must be the caller's tenant (`assertScope`). `level`
 * is `tenant` or `plant` (global is the in-code platform-default floor). Suppress runs the in-use probe.
 */
@Controller('reference-sets')
@UseGuards(JwtAuthGuard)
export class ReferenceSetController {
  constructor(
    private readonly refset: ReferenceSetService,
    private readonly read: ReferenceReadService,
  ) {}

  private parseLevel(level: string): 'tenant' | 'plant' {
    if (level !== 'tenant' && level !== 'plant') {
      throw new AppException(HttpStatus.BAD_REQUEST, `Reference-set level must be tenant or plant: ${level}`, ERROR_CODES.VALIDATION_ERROR)
    }
    return level
  }

  /** Tenant-level writes may only target the caller's own tenant scope. */
  private assertScope(level: 'tenant' | 'plant', scopeId: string, user: JwtPayload): void {
    if (level === 'tenant' && scopeId !== user.tenantId) {
      throw new AppException(HttpStatus.FORBIDDEN, 'Tenant-level reference-set scope must be your tenant', ERROR_CODES.FORBIDDEN)
    }
  }

  /** `GET /reference-sets` — the registered reference sets (summaries). */
  @Get()
  list() {
    return this.read.listReferenceSets()
  }

  /** `GET /reference-sets/:setKey?plantId=` — the resolved member set for the caller's scope. */
  @Get(':setKey')
  resolve(@CurrentUser() user: JwtPayload, @Param('setKey') setKey: string, @Query('plantId') plantId?: string) {
    return this.read.resolveReferenceSet(user.tenantId, setKey, { plantId })
  }

  /** `PUT /reference-sets/:setKey/:level/:scopeId/members/:memberKey` — add or override a member (ConfigureGuard). */
  @Put(':setKey/:level/:scopeId/members/:memberKey')
  @UseGuards(ConfigureGuard)
  setMember(
    @CurrentUser() user: JwtPayload,
    @Param('setKey') setKey: string,
    @Param('level') level: string,
    @Param('scopeId') scopeId: string,
    @Param('memberKey') memberKey: string,
    @Body(new ZodValidationPipe(setReferenceMemberSchema)) body: SetReferenceMemberRequest,
  ) {
    const lvl = this.parseLevel(level)
    this.assertScope(lvl, scopeId, user)
    return this.refset.setMember(setKey, lvl, scopeId, user.tenantId, memberKey, body.metadata, user.sub)
  }

  /** `POST /reference-sets/:setKey/:level/:scopeId/members/:memberKey/suppress` — suppress an inherited member (ConfigureGuard; runs the in-use probe). */
  @Post(':setKey/:level/:scopeId/members/:memberKey/suppress')
  @UseGuards(ConfigureGuard)
  suppress(
    @CurrentUser() user: JwtPayload,
    @Param('setKey') setKey: string,
    @Param('level') level: string,
    @Param('scopeId') scopeId: string,
    @Param('memberKey') memberKey: string,
  ) {
    const lvl = this.parseLevel(level)
    this.assertScope(lvl, scopeId, user)
    return this.refset.suppressMember(setKey, lvl, scopeId, user.tenantId, memberKey, user.sub)
  }

  /** `POST /reference-sets/:setKey/:level/:scopeId/members/:memberKey/restore` — restore a suppressed member (ConfigureGuard). */
  @Post(':setKey/:level/:scopeId/members/:memberKey/restore')
  @UseGuards(ConfigureGuard)
  restore(
    @CurrentUser() user: JwtPayload,
    @Param('setKey') setKey: string,
    @Param('level') level: string,
    @Param('scopeId') scopeId: string,
    @Param('memberKey') memberKey: string,
  ) {
    const lvl = this.parseLevel(level)
    this.assertScope(lvl, scopeId, user)
    return this.refset.restoreMember(setKey, lvl, scopeId, user.tenantId, memberKey, user.sub)
  }
}
