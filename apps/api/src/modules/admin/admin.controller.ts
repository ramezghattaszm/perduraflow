import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { AdminService } from './admin.service'
import { type SetConfigRequest, setConfigSchema } from './dto/set-config.dto'

/**
 * Admin routes manage platform_config only (the de-domained admin surface).
 * Both guards are required: JwtAuthGuard (authenticated) + RolesGuard with the
 * `Roles('admin')` decorator (authorized). (API-ARCHITECTURE.md §11)
 */
@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** `GET /admin/config` — list all platform config entries (admin only). */
  @Get()
  list() {
    return this.admin.listConfig()
  }

  /** `PUT /admin/config/:key` — upsert a platform config entry (admin only). */
  @Put(':key')
  set(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(setConfigSchema)) dto: SetConfigRequest,
  ) {
    return this.admin.setConfig(key, dto.value, dto.description)
  }
}
