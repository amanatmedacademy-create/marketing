import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreatePipelineDto, CreatePipelineStageDto } from './dto/create-pipeline.dto.js';

@Injectable()
export class PipelinesService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.pipeline.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        stages: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  async bootstrap(companyId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.pipeline.findFirst({
        where: { companyId, deletedAt: null },
        include: {
          stages: {
            where: { deletedAt: null },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
      });

      if (existing) return existing;

      return tx.pipeline.create({
        data: {
          companyId,
          name: 'Основная воронка',
          isDefault: true,
          position: 0,
          stages: {
            create: [
              { companyId, name: 'Новый лид', color: '#3B82F6', position: 0 },
              { companyId, name: 'В работе', color: '#F59E0B', position: 1 },
              { companyId, name: 'Назначена консультация', color: '#8B5CF6', position: 2 },
              { companyId, name: 'Продажа', color: '#22C55E', position: 3, isWon: true },
              { companyId, name: 'Отказ', color: '#EF4444', position: 4, isLost: true },
            ],
          },
        },
        include: {
          stages: { orderBy: { position: 'asc' } },
        },
      });
    });
  }

  async create(companyId: string, dto: CreatePipelineDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.pipeline.updateMany({
          where: { companyId, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }

      const count = await tx.pipeline.count({
        where: { companyId, deletedAt: null },
      });

      return tx.pipeline.create({
        data: {
          companyId,
          name: dto.name.trim(),
          isDefault: dto.isDefault ?? count === 0,
          position: count,
        },
      });
    });
  }

  async addStage(companyId: string, pipelineId: string, dto: CreatePipelineStageDto) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, companyId, deletedAt: null },
      select: { id: true },
    });

    if (!pipeline) throw new NotFoundException('Pipeline not found');

    const position = dto.position ?? await this.prisma.pipelineStage.count({
      where: { companyId, pipelineId, deletedAt: null },
    });

    return this.prisma.pipelineStage.create({
      data: {
        companyId,
        pipelineId,
        name: dto.name.trim(),
        color: dto.color ?? '#4F6EF7',
        position,
        isWon: dto.isWon ?? false,
        isLost: dto.isLost ?? false,
      },
    });
  }
}
