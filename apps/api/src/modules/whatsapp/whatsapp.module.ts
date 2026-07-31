import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppService, RolesGuard],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
