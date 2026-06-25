import { Body, Controller, Delete, Get, HttpStatus, Param, Put, Query, UseGuards } from '@nestjs/common'
import {
  type ConfigGroupKey,
  configGroupKeySchema,
  configOverrideUpdateSchema,
  type ConfigOverrideUpdate,
  ERROR_CODES,
} from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AppException } from '../../common/exceptions/app.exception'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { ConfigService } from './config.service'

/**
 * Configuration framework controls (CONFIG-FRAMEWORK-DESIGN). `GET` is any authenticated user
 * (view the resolved cascade); `PUT`/`DELETE` are ConfigureGuard (overrides are stated, audited
 * policy — D42). The stored tenantId is always the caller's; tenant-level scope must be the
 * caller's tenant. `level` is `tenant` or `plant` (global is the in-code default floor).
 */
@Controller('config')
@UseGuards(JwtAuthGuard)
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  private parseGroup(group: string): ConfigGroupKey {
    const parsed = configGroupKeySchema.safeParse(group)
    if (!parsed.success) {
      throw new AppException(HttpStatus.BAD_REQUEST, `Unknown config group: ${group}`, ERROR_CODES.VALIDATION_ERROR)
    }
    return parsed.data
  }

  private parseLevel(level: string): 'tenant' | 'plant' {
    if (level !== 'tenant' && level !== 'plant') {
      throw new AppException(HttpStatus.BAD_REQUEST, `Config level must be tenant or plant: ${level}`, ERROR_CODES.VALIDATION_ERROR)
    }
    return level
  }

  /** Tenant-level writes may only target the caller's own tenant scope. */
  private assertScope(level: 'tenant' | 'plant', scopeId: string, user: JwtPayload): void {
    if (level === 'tenant' && scopeId !== user.tenantId) {
      throw new AppException(HttpStatus.FORBIDDEN, 'Tenant-level config scope must be your tenant', ERROR_CODES.FORBIDDEN)
    }
  }

  /** `GET /config/:group?plantId=` — the resolved cascade view (global/tenant/plant + provenance). */
  @Get(':group')
  getGroup(
    @CurrentUser() user: JwtPayload,
    @Param('group') group: string,
    @Query('plantId') plantId?: string,
  ) {
    return this.config.getGroupView(this.parseGroup(group), user.tenantId, plantId)
  }

  /** `PUT /config/:group/:level/:scopeId` — set a sparse override at a level (ConfigureGuard). */
  @Put(':group/:level/:scopeId')
  @UseGuards(ConfigureGuard)
  setOverride(
    @CurrentUser() user: JwtPayload,
    @Param('group') group: string,
    @Param('level') level: string,
    @Param('scopeId') scopeId: string,
    @Body(new ZodValidationPipe(configOverrideUpdateSchema)) body: ConfigOverrideUpdate,
  ) {
    const lvl = this.parseLevel(level)
    this.assertScope(lvl, scopeId, user)
    return this.config.setOverride(this.parseGroup(group), lvl, scopeId, user.tenantId, body.fields, user.sub)
  }

  /** `DELETE /config/:group/:level/:scopeId?field=` — reset a field (or the whole level) to parent. */
  @Delete(':group/:level/:scopeId')
  @UseGuards(ConfigureGuard)
  reset(
    @CurrentUser() user: JwtPayload,
    @Param('group') group: string,
    @Param('level') level: string,
    @Param('scopeId') scopeId: string,
    @Query('field') field?: string,
  ) {
    const lvl = this.parseLevel(level)
    this.assertScope(lvl, scopeId, user)
    return this.config.resetToParent(this.parseGroup(group), lvl, scopeId, user.tenantId, field, user.sub)
  }
}
