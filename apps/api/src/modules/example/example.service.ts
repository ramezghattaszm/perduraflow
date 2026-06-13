import { HttpStatus, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import type {
  CreateExampleRequest,
  ExampleItem,
  Paginated,
  UpdateExampleRequest,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { assertOwnership } from '../../common/utils/ownership'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import type { Example } from '../../db/schema'
import { EVENTS } from '../../events'
import { ExampleRepository } from './example.repository'

const PAGE_SIZE = 20

/** Owner/admin DTO — full row. */
function toExampleItem(e: Example): ExampleItem {
  return {
    id: e.id,
    ownerId: e.ownerId,
    tenantId: e.tenantId,
    title: e.title,
    description: e.description,
    isActive: e.isActive,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }
}

/**
 * Public DTO tier — the reduced shape you'd return from a public/unauthenticated
 * listing (omits owner + tenant). Not wired to an endpoint in the template, but
 * kept as the reference for the three-tier pattern (public/owner/admin, §11).
 */
export function toExamplePublic(e: Example): Pick<ExampleItem, 'id' | 'title' | 'description'> {
  return { id: e.id, title: e.title, description: e.description }
}

/**
 * Service for the example resource — the reference pattern every owned resource
 * copies: owner + tenant scoping from the JWT, 403-not-404 on cross-user access,
 * owner-only mutation, soft delete, and event emission (§11/§2).
 */
@Injectable()
export class ExampleService {
  constructor(
    private readonly repo: ExampleRepository,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Creates an example owned by the caller. Ownership/tenant: `ownerId` and
   * `tenantId` come from the JWT (`user`), never the client body.
   *
   * Emits `example.created`.
   */
  async create(user: JwtPayload, dto: CreateExampleRequest): Promise<ExampleItem> {
    const row = await this.repo.create({
      ownerId: user.sub,
      tenantId: user.tenantId, // tenant scope comes from the JWT, never the client
      title: dto.title,
      description: dto.description ?? null,
    })
    this.events.emit(EVENTS.EXAMPLE_CREATED, {
      exampleId: row.id,
      ownerId: row.ownerId,
      tenantId: row.tenantId,
    })
    return toExampleItem(row)
  }

  /** The caller's own items (owner + tenant scoped). */
  async listOwn(user: JwtPayload, cursor?: string): Promise<Paginated<ExampleItem>> {
    const rows = await this.repo.listByOwner(user.sub, user.tenantId, cursor, PAGE_SIZE + 1)
    return this.paginate(rows)
  }

  /** Admin-only: every item in the admin's tenant (admin sees all). */
  async listAllForTenant(user: JwtPayload, cursor?: string): Promise<Paginated<ExampleItem>> {
    const rows = await this.repo.listByTenant(user.tenantId, cursor, PAGE_SIZE + 1)
    return this.paginate(rows)
  }

  /**
   * Returns one example. Ownership: the caller must own it — a non-owner gets
   * 403 (FORBIDDEN), not 404, when it exists (§11); admins may read any in-tenant.
   *
   * @throws AppException EXAMPLE_NOT_FOUND - no active example with this id
   * @throws AppException FORBIDDEN - exists but owned by another user (non-admin)
   */
  async getOne(user: JwtPayload, id: string): Promise<ExampleItem> {
    const row = await this.requireActive(id)
    // 403 (not 404) when it exists but isn't yours — unless you're an admin (§11).
    if (user.role !== 'admin') assertOwnership(user.sub, row.ownerId)
    return toExampleItem(row)
  }

  /**
   * Updates an example. Ownership: owner-only (admins do NOT bypass mutation);
   * `assertOwnership` enforces 403-not-404. Only provided fields change.
   *
   * @throws AppException EXAMPLE_NOT_FOUND - no active example with this id
   * @throws AppException FORBIDDEN - caller is not the owner
   */
  async update(user: JwtPayload, id: string, dto: UpdateExampleRequest): Promise<ExampleItem> {
    const row = await this.requireActive(id)
    assertOwnership(user.sub, row.ownerId) // mutate is owner-only
    const patch: Partial<Pick<Example, 'title' | 'description'>> = {}
    if (dto.title !== undefined) patch.title = dto.title
    if (dto.description !== undefined) patch.description = dto.description
    return toExampleItem(await this.repo.update(id, patch))
  }

  /**
   * Soft-deletes an example (sets isActive=false; never a hard delete, §2).
   * Ownership: owner-only via `assertOwnership` (403-not-404).
   *
   * Emits `example.deleted`.
   * @throws AppException EXAMPLE_NOT_FOUND - no active example with this id
   * @throws AppException FORBIDDEN - caller is not the owner
   */
  async remove(user: JwtPayload, id: string): Promise<{ success: true }> {
    const row = await this.requireActive(id)
    assertOwnership(user.sub, row.ownerId)
    await this.repo.softDelete(id) // soft delete only — never a hard DELETE (§2)
    this.events.emit(EVENTS.EXAMPLE_DELETED, {
      exampleId: row.id,
      ownerId: row.ownerId,
      tenantId: row.tenantId,
    })
    return { success: true }
  }

  // --- helpers ---------------------------------------------------------------
  private async requireActive(id: string): Promise<Example> {
    const row = await this.repo.findById(id)
    if (!row || !row.isActive) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Example not found', ERROR_CODES.EXAMPLE_NOT_FOUND)
    }
    return row
  }

  private paginate(rows: Example[]): Paginated<ExampleItem> {
    const hasMore = rows.length > PAGE_SIZE
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
    const items = page.map(toExampleItem)
    return { items, nextCursor: hasMore ? page[page.length - 1]!.id : null }
  }
}
