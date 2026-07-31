import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageDirection, MessageStatus, MessageType } from '@imds/database';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  ConfigureWhatsAppChannelDto,
  CreateWhatsAppChannelDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/whatsapp.dto.js';
import { MetaGraphService } from './meta-graph.service.js';
import { TokenCryptoService } from './token-crypto.service.js';

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCryptoService,
    private readonly graph: MetaGraphService,
  ) {}

  listChannels(companyId: string) {
    return this.prisma.whatsAppChannel.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        phoneNumberId: true,
        businessAccountId: true,
        configId: true,
        status: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });
  }

  createChannel(companyId: string, dto: CreateWhatsAppChannelDto) {
    const hasCredentials = Boolean(dto.phoneNumberId && dto.accessToken);
    return this.prisma.whatsAppChannel.create({
      data: {
        companyId,
        name: dto.name.trim(),
        phoneNumber: dto.phoneNumber?.trim(),
        phoneNumberId: dto.phoneNumberId?.trim(),
        businessAccountId: dto.businessAccountId?.trim(),
        configId: dto.configId?.trim(),
        accessTokenEncrypted: dto.accessToken ? this.crypto.encrypt(dto.accessToken.trim()) : null,
        status: hasCredentials ? 'CONNECTED' : dto.phoneNumberId ? 'PENDING' : 'DISCONNECTED',
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        phoneNumberId: true,
        businessAccountId: true,
        configId: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async configureChannel(companyId: string, channelId: string, dto: ConfigureWhatsAppChannelDto) {
    const channel = await this.prisma.whatsAppChannel.findFirst({
      where: { id: channelId, companyId, deletedAt: null },
    });
    if (!channel) throw new NotFoundException('WhatsApp channel not found');

    const phoneNumberId = dto.phoneNumberId?.trim() ?? channel.phoneNumberId;
    const encryptedToken = dto.accessToken
      ? this.crypto.encrypt(dto.accessToken.trim())
      : channel.accessTokenEncrypted;

    return this.prisma.whatsAppChannel.update({
      where: { id: channelId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber.trim() } : {}),
        ...(dto.phoneNumberId !== undefined ? { phoneNumberId: dto.phoneNumberId.trim() } : {}),
        ...(dto.businessAccountId !== undefined ? { businessAccountId: dto.businessAccountId.trim() } : {}),
        ...(dto.configId !== undefined ? { configId: dto.configId.trim() } : {}),
        ...(dto.accessToken !== undefined ? { accessTokenEncrypted: encryptedToken } : {}),
        status: phoneNumberId && encryptedToken ? 'CONNECTED' : phoneNumberId ? 'PENDING' : 'DISCONNECTED',
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        phoneNumberId: true,
        businessAccountId: true,
        configId: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  listConversations(companyId: string, channelId?: string) {
    return this.prisma.conversation.findMany({
      where: {
        companyId,
        ...(channelId ? { channelId } : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        channel: { select: { id: true, name: true, phoneNumber: true } },
        deal: { select: { id: true, title: true, stageId: true, amount: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, text: true, type: true, direction: true, status: true, createdAt: true },
        },
      },
    });
  }

  async getConversation(companyId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      include: {
        channel: { select: { id: true, name: true, phoneNumber: true, status: true } },
        deal: { select: { id: true, title: true, stageId: true, amount: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async updateConversation(companyId: string, conversationId: string, dto: UpdateConversationDto) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, companyId } });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (dto.dealId) {
      const deal = await this.prisma.deal.findFirst({ where: { id: dto.dealId, companyId, deletedAt: null }, select: { id: true } });
      if (!deal) throw new BadRequestException('Deal does not belong to this company');
    }

    if (dto.assigneeId) {
      const membership = await this.prisma.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: dto.assigneeId } },
        select: { id: true },
      });
      if (!membership) throw new BadRequestException('Assignee does not belong to this company');
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.status !== undefined ? { status: dto.status, closedAt: dto.status === 'CLOSED' ? new Date() : null } : {}),
        ...(dto.dealId !== undefined ? { dealId: dto.dealId } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
      },
    });
  }

  async sendMessage(companyId: string, userId: string, conversationId: string, dto: SendMessageDto) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      include: {
        channel: {
          select: {
            id: true,
            status: true,
            phoneNumberId: true,
            accessTokenEncrypted: true,
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!dto.text && !dto.mediaUrl) throw new BadRequestException('Message text or mediaUrl is required');
    if (
      conversation.channel.status !== 'CONNECTED'
      || !conversation.channel.phoneNumberId
      || !conversation.channel.accessTokenEncrypted
    ) {
      throw new BadRequestException('WhatsApp channel is not fully connected');
    }

    const type = dto.type ?? MessageType.TEXT;
    const created = await this.prisma.message.create({
      data: {
        companyId,
        conversationId,
        senderUserId: userId,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.QUEUED,
        type,
        text: dto.text?.trim(),
        mediaUrl: dto.mediaUrl?.trim(),
      },
    });

    try {
      const result = await this.graph.sendMessage({
        phoneNumberId: conversation.channel.phoneNumberId,
        accessToken: this.crypto.decrypt(conversation.channel.accessTokenEncrypted),
        recipient: conversation.contactPhone,
        type,
        text: dto.text?.trim(),
        mediaUrl: dto.mediaUrl?.trim(),
      });

      const sentAt = new Date();
      const message = await this.prisma.message.update({
        where: { id: created.id },
        data: {
          externalMessageId: result.externalMessageId,
          status: MessageStatus.SENT,
          sentAt,
          metadata: result.raw,
        },
      });
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: sentAt },
      });
      return message;
    } catch (error) {
      await this.prisma.message.update({
        where: { id: created.id },
        data: {
          status: MessageStatus.FAILED,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown Meta Graph API error',
          },
        },
      });
      throw error;
    }
  }
}
