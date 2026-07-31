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
