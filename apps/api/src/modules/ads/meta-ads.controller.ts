import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@imds/database';
import { CurrentTenant, type TenantPrincipal } from '../../common/auth/current-tenant.decorator.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ConfigureMetaAdsDto, MetaAdsRangeDto } from './dto/meta-ads.dto.js';
import { MetaAdsService } from './meta-ads.service.js';

@Controller('ads/meta')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class MetaAdsController {
  constructor(private readonly metaAdsService: MetaAdsService) {}

  @Get('status')
  getStatus(@CurrentTenant() principal: TenantPrincipal) {
    return this.metaAdsService.getStatus(principal.companyId);
  }

  @Patch('configuration')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  configure(
    @CurrentTenant() principal: TenantPrincipal,
    @Body() dto: ConfigureMetaAdsDto,
  ) {
    return this.metaAdsService.configure(principal.companyId, dto);
  }

  @Get('accounts')
  listAccounts(@CurrentTenant() principal: TenantPrincipal) {
    return this.metaAdsService.listAccounts(principal.companyId);
  }

  @Get('campaigns')
  listCampaigns(
    @CurrentTenant() principal: TenantPrincipal,
    @Query('adAccountId') adAccountId?: string,
  ) {
    return this.metaAdsService.listCampaigns(principal.companyId, adAccountId);
  }

  @Get('insights')
  getInsights(
    @CurrentTenant() principal: TenantPrincipal,
    @Query() range: MetaAdsRangeDto,
  ) {
    return this.metaAdsService.getInsights(principal.companyId, range);
  }

  @Get('lead-forms')
  listLeadForms(@CurrentTenant() principal: TenantPrincipal) {
    return this.metaAdsService.listLeadForms(principal.companyId);
  }

  @Get('report')
  getReport(
    @CurrentTenant() principal: TenantPrincipal,
    @Query() range: MetaAdsRangeDto,
  ) {
    return this.metaAdsService.getPerformanceReport(principal.companyId, range);
  }
}
