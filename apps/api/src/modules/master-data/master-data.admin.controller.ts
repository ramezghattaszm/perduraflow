import { Body, Controller, Delete, Param, Patch, Post, Put, UseGuards } from '@nestjs/common'
import {
  addUomFactorSchema,
  createToolingAssetSchema,
  updateToolingAssetSchema,
  type CreateToolingAssetRequest,
  type UpdateToolingAssetRequest,
  publishBomSchema,
  reviseBomSchema,
  type PublishBomRequest,
  type ReviseBomRequest,
  createCertificationSchema,
  createOperatorSchema,
  createPartSchema,
  createResourceDowntimeSchema,
  createResourceGroupSchema,
  createResourceSchema,
  createRoutingSchema,
  setOperatorQualificationSchema,
  setPartPlantOverrideSchema,
  setPlantPartMappingSchema,
  updateCertificationSchema,
  updateOperatorSchema,
  updatePartSchema,
  updateResourceGroupSchema,
  updateResourceSchema,
  updateRoutingSchema,
  type AddUomFactorRequest,
  type CreateCertificationRequest,
  type CreateOperatorRequest,
  type CreatePartRequest,
  type CreateResourceDowntimeRequest,
  type CreateResourceGroupRequest,
  type CreateResourceRequest,
  type CreateRoutingRequest,
  type SetOperatorQualificationRequest,
  type SetPartPlantOverrideRequest,
  type SetPlantPartMappingRequest,
  type UpdateCertificationRequest,
  type UpdateOperatorRequest,
  type UpdatePartRequest,
  type UpdateResourceGroupRequest,
  type UpdateResourceRequest,
  type UpdateRoutingRequest,
} from '@perduraflow/contracts'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/types/jwt-payload.types'
import { AssetReadService } from './asset-read.service'
import { BomReadService } from './bom-read.service'
import { MasterDataService } from './master-data.service'

/**
 * Admin CRUD for master data (`/admin/master-data/*`). Both guards required
 * (API §11): JwtAuthGuard + ConfigureGuard. Every write is tenant-scoped from
 * the JWT; org references are validated through `org.read` in the service (O4).
 */
@Controller('admin/master-data')
@UseGuards(JwtAuthGuard, ConfigureGuard)
export class MasterDataAdminController {
  constructor(
    private readonly md: MasterDataService,
    private readonly bom: BomReadService,
    private readonly asset: AssetReadService,
  ) {}

  // --- tooling asset admin (Layer 2 2b — Pattern B, both guards, audited) -----
  /** `POST /admin/master-data/tooling-assets` — create a tooling asset (+ eligibility + part map). */
  @Post('tooling-assets')
  createToolingAsset(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createToolingAssetSchema)) dto: CreateToolingAssetRequest,
  ) {
    return this.asset.createToolingAsset(user.tenantId, dto, user.sub)
  }

  /** `PATCH /admin/master-data/tooling-assets/:id` — update a tooling asset in place. */
  @Patch('tooling-assets/:id')
  updateToolingAsset(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateToolingAssetSchema)) dto: UpdateToolingAssetRequest,
  ) {
    return this.asset.updateToolingAsset(user.tenantId, id, dto, user.sub)
  }

  /** `DELETE /admin/master-data/tooling-assets/:id` — deactivate a tooling asset (soft-delete). */
  @Delete('tooling-assets/:id')
  deactivateToolingAsset(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.asset.deactivateToolingAsset(user.tenantId, id, user.sub)
  }

  // --- bom draft authoring (Layer 2 2a — native-SoR writes, both guards) -----
  /** `PUT /admin/master-data/boms/:parentPartNo/draft` — author/replace the open draft BOM + its edges. */
  @Put('boms/:parentPartNo/draft')
  reviseBom(
    @CurrentUser() user: JwtPayload,
    @Param('parentPartNo') parentPartNo: string,
    @Body(new ZodValidationPipe(reviseBomSchema)) dto: ReviseBomRequest,
  ) {
    return this.bom.reviseBom(user.tenantId, parentPartNo, dto, user.sub)
  }

  /** `POST /admin/master-data/boms/:parentPartNo/publish` — publish the open draft (integrity-gated, blocking). */
  @Post('boms/:parentPartNo/publish')
  publishBom(
    @CurrentUser() user: JwtPayload,
    @Param('parentPartNo') parentPartNo: string,
    @Body(new ZodValidationPipe(publishBomSchema)) dto: PublishBomRequest,
  ) {
    return this.bom.publishBom(user.tenantId, parentPartNo, dto.effectiveFrom, user.sub)
  }

  // --- part ------------------------------------------------------------------
  /** `POST /admin/master-data/parts` — create a part. */
  @Post('parts')
  createPart(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createPartSchema)) dto: CreatePartRequest,
  ) {
    return this.md.createPart(user.tenantId, dto)
  }

  /** `PATCH /admin/master-data/parts/:id` — update a part. */
  @Patch('parts/:id')
  updatePart(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePartSchema)) dto: UpdatePartRequest,
  ) {
    return this.md.updatePart(user.tenantId, id, dto, user.sub)
  }

  // --- part_plant / plant_part_mapping / uom factors (Layer 1 §4B/§4D/§4E) ---
  /**
   * `POST /admin/master-data/parts/:partNo/plants/:plantId/override` — set a per-plant part override
   * (§4E). Windowed + audited write (JWT actor recorded); plant validated via org.read (O4).
   */
  @Post('parts/:partNo/plants/:plantId/override')
  setPartPlantOverride(
    @CurrentUser() user: JwtPayload,
    @Param('partNo') partNo: string,
    @Param('plantId') plantId: string,
    @Body(new ZodValidationPipe(setPartPlantOverrideSchema)) dto: SetPartPlantOverrideRequest,
  ) {
    const { effectiveFrom, ...changes } = dto
    return this.md.setPartPlantOverride(user.tenantId, partNo, plantId, changes, effectiveFrom, user.sub)
  }

  /**
   * `POST /admin/master-data/plants/:plantId/part-mappings` — set a plant-local alias `(plantId,
   * plantPartNo) → partNo` (§4D / MD9). Windowed + audited write (JWT actor recorded); plant + target
   * part validated (O4).
   */
  @Post('plants/:plantId/part-mappings')
  setPlantPartMapping(
    @CurrentUser() user: JwtPayload,
    @Param('plantId') plantId: string,
    @Body(new ZodValidationPipe(setPlantPartMappingSchema)) dto: SetPlantPartMappingRequest,
  ) {
    return this.md.setPlantPartMapping(user.tenantId, plantId, dto.plantPartNo, dto.partNo, dto.effectiveFrom, user.sub)
  }

  /**
   * `POST /admin/master-data/part-versions/:versionId/uom-factors` — publish a UoM conversion factor
   * onto a part version (§4B). Upsert + audited (JWT actor recorded); base_uom taken from the version.
   */
  @Post('part-versions/:versionId/uom-factors')
  addUomFactor(
    @CurrentUser() user: JwtPayload,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(addUomFactorSchema)) dto: AddUomFactorRequest,
  ) {
    return this.md.addUomFactor(user.tenantId, versionId, dto.alternateUom, dto.factor, user.sub)
  }

  // --- resource --------------------------------------------------------------
  /** `POST /admin/master-data/resources` — create a resource. */
  @Post('resources')
  createResource(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createResourceSchema)) dto: CreateResourceRequest,
  ) {
    return this.md.createResource(user.tenantId, dto, user.sub)
  }

  /** `PATCH /admin/master-data/resources/:id` — update a resource. */
  @Patch('resources/:id')
  updateResource(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateResourceSchema)) dto: UpdateResourceRequest,
  ) {
    return this.md.updateResource(user.tenantId, id, dto, user.sub)
  }

  // --- resource downtime (line-down / maintenance) ---------------------------
  /** `POST /admin/master-data/downtime` — open a downtime window (the simulator line-down). */
  @Post('downtime')
  createDowntime(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createResourceDowntimeSchema)) dto: CreateResourceDowntimeRequest,
  ) {
    return this.md.createDowntime(user.tenantId, dto, user.sub)
  }

  /** `POST /admin/master-data/downtime/:id/close` — bring the line back up (end the outage now). */
  @Post('downtime/:id/close')
  closeDowntime(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.md.closeDowntimeNow(user.tenantId, id)
  }

  /** `DELETE /admin/master-data/downtime/:id` — retract a window opened in error (soft-delete). */
  @Delete('downtime/:id')
  retractDowntime(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.md.retractDowntime(user.tenantId, id)
  }

  // --- resource group --------------------------------------------------------
  /** `POST /admin/master-data/resource-groups` — create a resource group. */
  @Post('resource-groups')
  createResourceGroup(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createResourceGroupSchema)) dto: CreateResourceGroupRequest,
  ) {
    return this.md.createResourceGroup(user.tenantId, dto, user.sub)
  }

  /** `PATCH /admin/master-data/resource-groups/:id` — update a resource group. */
  @Patch('resource-groups/:id')
  updateResourceGroup(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateResourceGroupSchema)) dto: UpdateResourceGroupRequest,
  ) {
    return this.md.updateResourceGroup(user.tenantId, id, dto, user.sub)
  }

  // --- routing ---------------------------------------------------------------
  /** `POST /admin/master-data/routings` — create a routing (+ operations). */
  @Post('routings')
  createRouting(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createRoutingSchema)) dto: CreateRoutingRequest,
  ) {
    return this.md.createRouting(user.tenantId, dto)
  }

  /** `PATCH /admin/master-data/routings/:id` — update a routing (replaces operations when supplied). */
  @Patch('routings/:id')
  updateRouting(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoutingSchema)) dto: UpdateRoutingRequest,
  ) {
    return this.md.updateRouting(user.tenantId, id, dto, user.sub)
  }

  // --- certification ---------------------------------------------------------
  /** `POST /admin/master-data/certifications` — create a certification. */
  @Post('certifications')
  createCertification(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createCertificationSchema)) dto: CreateCertificationRequest,
  ) {
    return this.md.createCertification(user.tenantId, dto)
  }

  /** `PATCH /admin/master-data/certifications/:id` — update a certification. */
  @Patch('certifications/:id')
  updateCertification(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCertificationSchema)) dto: UpdateCertificationRequest,
  ) {
    return this.md.updateCertification(user.tenantId, id, dto)
  }

  // --- operator + qualifications ---------------------------------------------
  /** `POST /admin/master-data/operators` — create an operator. */
  @Post('operators')
  createOperator(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createOperatorSchema)) dto: CreateOperatorRequest,
  ) {
    return this.md.createOperator(user.tenantId, dto)
  }

  /** `PATCH /admin/master-data/operators/:id` — update an operator. */
  @Patch('operators/:id')
  updateOperator(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOperatorSchema)) dto: UpdateOperatorRequest,
  ) {
    return this.md.updateOperator(user.tenantId, id, dto)
  }

  /** `PATCH /admin/master-data/operators/:id/qualifications` — toggle one cert (matrix, FS6). */
  @Patch('operators/:id/qualifications')
  setOperatorQualification(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setOperatorQualificationSchema)) dto: SetOperatorQualificationRequest,
  ) {
    return this.md.setOperatorQualification(user.tenantId, id, dto)
  }
}
