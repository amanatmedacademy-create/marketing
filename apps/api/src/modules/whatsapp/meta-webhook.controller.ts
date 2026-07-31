import { Body, Controller, Get, Headers, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { MetaSignatureService } from './meta-signature.service.js';
import { MetaWebhookService } from './meta-webhook.service.js';

@Controller('webhooks/meta/whatsapp')
export class MetaWebhookController {
  constructor(
    private readonly webhookService: MetaWebhookService,
    private readonly signatureService: MetaSignatureService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    return this.webhookService.verify(mode, token, challenge);
  }

  @Post()
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    this.signatureService.verify(request.rawBody, signature);
    return this.webhookService.receive(body as Parameters<MetaWebhookService['receive']>[0]);
  }
}
