import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageDirection, MessageStatus, MessageType } from '@imds/database';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreateWhatsAppChannelDto, SendMessageDto, UpdateConversationDto } from './dto/whatsapp.dto.js';

@Injectable()
export class WhatsAppService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.whatsAppChannel.create({
      data: {
        companyId,
        name: dto.name.trim(),
        phoneNumber: dto.phoneNumber?.trim(),
        phoneNumberId: dto.phoneNumberId?.trim(),
        businessAccountId: dto.businessAccountId?.trim(),
        configId: dto.configId?.trim(),
        status: dto.phoneNumberId ? 'PENDING' : 'DISCONNECTED',
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
      include: { channel: { select: { id: true, status: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!dto.text && !dto.mediaUrl) throw new BadRequestException('Message text or mediaUrl is required');

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          companyId,
          conversationId,
          senderUserId: userId,
          direction: MessageDirection.OUTBOUND,
          status: conversation.channel.status === 'CONNECTED' ? MessageStatus.QUEUED : MessageStatus.FAILED,
          type: dto.type ?? MessageType.TEXT,
          text: dto.text?.trim(),
          mediaUrl: dto.mediaUrl?.trim(),
          metadata: conversation.channel.status === 'CONNECTED' ? {} : { error: 'WhatsApp channel is not connected' },
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });

    return message;
  }
}
