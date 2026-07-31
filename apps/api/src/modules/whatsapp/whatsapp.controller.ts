import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@imds/database';
import { CurrentTenant, type TenantPrincipal } from '../../common/auth/current-tenant.decorator.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import {
  ConfigureWhatsAppChannelDto,
  CreateWhatsAppChannelDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/whatsapp.dto.js';
import { WhatsAppService } from './whatsapp.service.js';

@Controller('whatsapp')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Get('channels')
  listChannels(@CurrentTenant() principal: TenantPrincipal) {
    return this.whatsappService.listChannels(principal.companyId);
  }

  @Post('channels')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createChannel(
    @CurrentTenant() principal: TenantPrincipal,
    @Body() dto: CreateWhatsAppChannelDto,
  ) {
    return this.whatsappService.createChannel(principal.companyId, dto);
  }

  @Patch('channels/:channelId')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  configureChannel(
    @CurrentTenant() principal: TenantPrincipal,
    @Param('channelId') channelId: string,
    @Body() dto: ConfigureWhatsAppChannelDto,
  ) {
    return this.whatsappService.configureChannel(principal.companyId, channelId, dto);
  }

  @Get('conversations')
  listConversations(
    @CurrentTenant() principal: TenantPrincipal,
    @Query('channelId') channelId?: string,
  ) {
    return this.whatsappService.listConversations(principal.companyId, channelId);
  }

  @Get('conversations/:conversationId')
  getConversation(
    @CurrentTenant() principal: TenantPrincipal,
    @Param('conversationId') conversationId: string,
  ) {
    return this.whatsappService.getConversation(principal.companyId, conversationId);
  }

  @Patch('conversations/:conversationId')
  updateConversation(
    @CurrentTenant() principal: TenantPrincipal,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.whatsappService.updateConversation(principal.companyId, conversationId, dto);
  }

  @Post('conversations/:conversationId/messages')
  sendMessage(
    @CurrentTenant() principal: TenantPrincipal,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.whatsappService.sendMessage(principal.companyId, principal.sub, conversationId, dto);
  }
}
