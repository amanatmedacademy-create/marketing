import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { MetaGraphService } from './meta-graph.service.js';
import { MetaSignatureService } from './meta-signature.service.js';
import { MetaWebhookController } from './meta-webhook.controller.js';
import { MetaWebhookService } from './meta-webhook.service.js';
import { TokenCryptoService } from './token-crypto.service.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({
  controllers: [WhatsAppController, MetaWebhookController],
  providers: [
    WhatsAppService,
    MetaWebhookService,
    MetaSignatureService,
    MetaGraphService,
    TokenCryptoService,
    RolesGuard,
  ],
  exports: [WhatsAppService, MetaWebhookService],
})
export class WhatsAppModule {}
