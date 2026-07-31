import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MetaWebhookService } from './meta-webhook.service.js';

@Controller('api/v1/webhooks/meta/whatsapp')
export class MetaWebhookController {
  constructor(private readonly webhookService: MetaWebhookService) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    return this.webhookService.verify(mode, token, challenge);
  }

  @Post()
  receive(@Body() body: unknown) {
    return this.webhookService.receive(body as Parameters<MetaWebhookService['receive']>[0]);
  }
}
