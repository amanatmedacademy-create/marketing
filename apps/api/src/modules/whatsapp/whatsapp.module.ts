import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { MetaWebhookController } from './meta-webhook.controller.js';
import { MetaWebhookService } from './meta-webhook.service.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({
  controllers: [WhatsAppController, MetaWebhookController],
  providers: [WhatsAppService, MetaWebhookService, RolesGuard],
  exports: [WhatsAppService, MetaWebhookService],
})
export class WhatsAppModule {}
