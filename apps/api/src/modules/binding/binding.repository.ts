import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import type { BindingMode } from '@perduraflow/contracts'
import { BINDING_DB, type BindingDatabase } from './binding.db'
import { contractBinding } from './schema'

/** Drizzle queries for the `binding` module (scoped to its own schema, O2). */
@Injectable()
export class BindingRepository {
  constructor(@Inject(BINDING_DB) private readonly db: BindingDatabase) {}

  /** The bound counterpart mode for a tenant's domain contract, or undefined. */
  async findMode(tenantId: string, contractId: string): Promise<BindingMode | undefined> {
    const row = await this.db.query.contractBinding.findFirst({
      where: and(eq(contractBinding.tenantId, tenantId), eq(contractBinding.contractId, contractId)),
    })
    return row?.mode
  }
}
