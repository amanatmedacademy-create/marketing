import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@imds/database';
import { CurrentTenant, type TenantPrincipal } from '../../common/auth/current-tenant.decorator.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CreatePipelineDto, CreatePipelineStageDto } from './dto/create-pipeline.dto.js';
import { PipelinesService } from './pipelines.service.js';

@Controller('pipelines')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  @Get()
  list(@CurrentTenant() principal: TenantPrincipal) {
    return this.pipelinesService.list(principal.companyId);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(
    @CurrentTenant() principal: TenantPrincipal,
    @Body() dto: CreatePipelineDto,
  ) {
    return this.pipelinesService.create(principal.companyId, dto);
  }

  @Post(':pipelineId/stages')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  addStage(
    @CurrentTenant() principal: TenantPrincipal,
    @Param('pipelineId') pipelineId: string,
    @Body() dto: CreatePipelineStageDto,
  ) {
    return this.pipelinesService.addStage(principal.companyId, pipelineId, dto);
  }
}
