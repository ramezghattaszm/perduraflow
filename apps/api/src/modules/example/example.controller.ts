import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  type CreateExampleRequest,
  createExampleSchema,
  type UpdateExampleRequest,
  updateExampleSchema,
} from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { ExampleService } from './example.service'

/**
 * Reference resource controller. Class-level JwtAuthGuard protects every route.
 * The admin route additionally stacks RolesGuard + the `Roles('admin')`
 * decorator — admin routes require BOTH guards (API-ARCHITECTURE.md §11).
 */
@Controller('example')
@UseGuards(JwtAuthGuard)
export class ExampleController {
  constructor(private readonly example: ExampleService) {}

  /** `POST /example` — create an example owned by the caller. */
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createExampleSchema)) dto: CreateExampleRequest,
  ) {
    return this.example.create(user, dto)
  }

  /** `GET /example` — the caller's own examples (cursor-paginated). */
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('cursor') cursor?: string) {
    return this.example.listOwn(user, cursor)
  }

  /**
   * `GET /example/admin/all` — every example in the caller's tenant (admin sees
   * all). Admin-only: JwtAuthGuard (class) + RolesGuard + `Roles('admin')`.
   * Declared before `:id` so the static segment wins.
   */
  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  listAll(@CurrentUser() user: JwtPayload, @Query('cursor') cursor?: string) {
    return this.example.listAllForTenant(user, cursor)
  }

  /** `GET /example/:id` — one example; owner or admin only (else 403, §11). */
  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.example.getOne(user, id)
  }

  /** `PATCH /example/:id` — update; owner-only. */
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExampleSchema)) dto: UpdateExampleRequest,
  ) {
    return this.example.update(user, id, dto)
  }

  /** `DELETE /example/:id` — soft-delete; owner-only. */
  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.example.remove(user, id)
  }
}
