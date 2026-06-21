import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import {
  addTurnSchema,
  createConversationSchema,
  renameConversationSchema,
  type AddTurnRequest,
  type CreateConversationRequest,
  type RenameConversationRequest,
} from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { ConversationService } from './conversation.service'

/**
 * Conversation routes (phase 6, `GET/POST /scheduling/conversations`). Tenant-scoped
 * from the JWT, strict isolation. The conversation constructs + explains scenarios
 * (grounded in stored/engine results); it never commits — Apply stays on the admin
 * what-if/apply guardrail (D26). The assistant reply returns as JSON; the UI shows a
 * pending indicator while the grounded tool-loop runs.
 */
@Controller('scheduling/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  /** `POST /scheduling/conversations` — start a conversation with a first message. */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body(new ZodValidationPipe(createConversationSchema)) dto: CreateConversationRequest) {
    return this.conversations.create(user.tenantId, dto.plantId, dto.message, user.sub, dto.screenContext)
  }

  /** `GET /scheduling/conversations` — the tenant's conversations (newest first). */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.conversations.list(user.tenantId)
  }

  /** `GET /scheduling/conversations/:id` — a conversation + its ordered turns. */
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.conversations.get(user.tenantId, id)
  }

  /** `POST /scheduling/conversations/:id/turns` — add a user turn → grounded assistant reply. */
  @Post(':id/turns')
  addTurn(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addTurnSchema)) dto: AddTurnRequest,
  ) {
    return this.conversations.addTurn(user.tenantId, id, dto.message, user.sub, dto.screenContext)
  }

  /** `PATCH /scheduling/conversations/:id` — rename. */
  @Patch(':id')
  rename(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameConversationSchema)) dto: RenameConversationRequest,
  ) {
    return this.conversations.rename(user.tenantId, id, dto.name)
  }
}
