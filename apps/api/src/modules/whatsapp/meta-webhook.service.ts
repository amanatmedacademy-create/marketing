import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@imds/database';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

type MetaStatus = {
  id?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: string;
  errors?: unknown[];
};

type MetaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  audio?: { id?: string };
  document?: { id?: string; filename?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
};

type MetaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
};

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: MetaValue }>;
  }>;
};

@Injectable()
export class MetaWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  verify(mode?: string, token?: string, challenge?: string) {
    const expected = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');
    if (!expected || mode !== 'subscribe' || !token || !challenge) {
      throw new ForbiddenException('Webhook verification failed');
    }

    const expectedBuffer = Buffer.from(expected);
    const tokenBuffer = Buffer.from(token);
    if (expectedBuffer.length !== tokenBuffer.length || !timingSafeEqual(expectedBuffer, tokenBuffer)) {
      throw new ForbiddenException('Webhook verification failed');
    }

    return challenge;
  }

  async receive(body: MetaWebhookBody) {
    if (body.object !== 'whatsapp_business_account') {
      return { accepted: true, processed: 0 };
    }

    let processed = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!value || !phoneNumberId) continue;

        const channel = await this.prisma.whatsAppChannel.findFirst({
          where: { phoneNumberId, deletedAt: null },
          select: { id: true, companyId: true },
        });
        if (!channel) throw new NotFoundException('WhatsApp channel is not registered');

        for (const message of value.messages ?? []) {
          await this.processIncomingMessage(channel, value, message);
          processed += 1;
        }

        for (const status of value.statuses ?? []) {
          await this.processStatus(channel, status);
          processed += 1;
        }
      }
    }

    return { accepted: true, processed };
  }

  private async processIncomingMessage(
    channel: { id: string; companyId: string },
    value: MetaValue,
    message: MetaMessage,
  ) {
    if (!message.id || !message.from) return;

    const eventExternalId = `message:${message.id}`;
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: 'META_WHATSAPP', externalId: eventExternalId } },
      select: { id: true },
    });
    if (existingEvent) return;

    const contact = value.contacts?.find((item) => item.wa_id === message.from) ?? value.contacts?.[0];
    const createdAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
    const type = this.mapType(message.type);
    const text = this.extractText(message);
    const payload = message as unknown as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.upsert({
        where: { channelId_externalChatId: { channelId: channel.id, externalChatId: message.from! } },
        create: {
          companyId: channel.companyId,
          channelId: channel.id,
          externalChatId: message.from!,
          contactPhone: message.from!,
          contactName: contact?.profile?.name,
          unreadCount: 1,
          lastMessageAt: createdAt,
        },
        update: {
          contactName: contact?.profile?.name,
          unreadCount: { increment: 1 },
          lastMessageAt: createdAt,
          status: 'OPEN',
          closedAt: null,
        },
      });

      await tx.message.upsert({
        where: {
          companyId_externalMessageId: {
            companyId: channel.companyId,
            externalMessageId: message.id!,
          },
        },
        create: {
          companyId: channel.companyId,
          conversationId: conversation.id,
          externalMessageId: message.id!,
          direction: MessageDirection.INBOUND,
          status: MessageStatus.RECEIVED,
          type,
          text,
          metadata: payload,
          createdAt,
        },
        update: {},
      });

      await tx.webhookEvent.create({
        data: {
          companyId: channel.companyId,
          channelId: channel.id,
          provider: 'META_WHATSAPP',
          externalId: eventExternalId,
          eventType: 'message.received',
          payload,
          processedAt: new Date(),
        },
      });
    });
  }

  private async processStatus(
    channel: { id: string; companyId: string },
    status: MetaStatus,
  ) {
    if (!status.id || !status.status) return;

    const eventExternalId = `status:${status.id}:${status.status}:${status.timestamp ?? ''}`;
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: 'META_WHATSAPP', externalId: eventExternalId } },
      select: { id: true },
    });
    if (existingEvent) return;

    const mappedStatus = this.mapStatus(status.status);
    const eventAt = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
    const payload = status as unknown as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.findFirst({
        where: { companyId: channel.companyId, externalMessageId: status.id },
        select: { id: true },
      });

      if (message) {
        await tx.message.update({
          where: { id: message.id },
          data: {
            status: mappedStatus,
            ...(mappedStatus === MessageStatus.SENT ? { sentAt: eventAt } : {}),
            ...(mappedStatus === MessageStatus.DELIVERED ? { deliveredAt: eventAt } : {}),
            ...(mappedStatus === MessageStatus.READ ? { readAt: eventAt } : {}),
            ...(mappedStatus === MessageStatus.FAILED ? { metadata: payload } : {}),
          },
        });
      }

      await tx.webhookEvent.create({
        data: {
          companyId: channel.companyId,
          channelId: channel.id,
          provider: 'META_WHATSAPP',
          externalId: eventExternalId,
          eventType: `message.${status.status}`,
          payload,
          processedAt: new Date(),
        },
      });
    });
  }

  private mapStatus(status: NonNullable<MetaStatus['status']>) {
    if (status === 'sent') return MessageStatus.SENT;
    if (status === 'delivered') return MessageStatus.DELIVERED;
    if (status === 'read') return MessageStatus.READ;
    return MessageStatus.FAILED;
  }

  private mapType(type?: string) {
    const mapping: Record<string, MessageType> = {
      text: MessageType.TEXT,
      image: MessageType.IMAGE,
      video: MessageType.VIDEO,
      audio: MessageType.AUDIO,
      document: MessageType.DOCUMENT,
      location: MessageType.LOCATION,
      contacts: MessageType.CONTACT,
      template: MessageType.TEMPLATE,
    };
    return mapping[type ?? ''] ?? MessageType.SYSTEM;
  }

  private extractText(message: MetaMessage) {
    if (message.text?.body) return message.text.body;
    if (message.image?.caption) return message.image.caption;
    if (message.video?.caption) return message.video.caption;
    if (message.document?.caption) return message.document.caption;
    if (message.document?.filename) return message.document.filename;
    if (message.location) return [message.location.name, message.location.address].filter(Boolean).join(' — ') || 'Геолокация';
    if (message.contacts?.length) return 'Контакт';
    return null;
  }
}
