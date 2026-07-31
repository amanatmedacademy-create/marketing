import type { FastifyPluginAsync } from 'fastify';
import { createPipelineSchema, createStageSchema } from './pipeline.schemas.js';

export const pipelineRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => ({
    data: await app.prisma.pipeline.findMany({
      where: { companyId: request.auth.companyId, deletedAt: null },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { deals: true } } },
      orderBy: { position: 'asc' },
    }),
  }));

  app.post('/', async (request, reply) => {
    const input = createPipelineSchema.parse(request.body);
    const pipeline = await app.prisma.$transaction(async (tx) => {
      const position = await tx.pipeline.count({ where: { companyId: request.auth.companyId, deletedAt: null } });
      if (input.isDefault) await tx.pipeline.updateMany({ where: { companyId: request.auth.companyId }, data: { isDefault: false } });
      return tx.pipeline.create({ data: { companyId: request.auth.companyId, name: input.name, isDefault: input.isDefault, position } });
    });
    return reply.code(201).send({ data: pipeline });
  });

  app.post('/:pipelineId/stages', async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    const input = createStageSchema.parse(request.body);
    const pipeline = await app.prisma.pipeline.findFirst({ where: { id: pipelineId, companyId: request.auth.companyId, deletedAt: null } });
    if (!pipeline) throw app.httpErrors.notFound('PIPELINE_NOT_FOUND');
    const position = await app.prisma.pipelineStage.count({ where: { pipelineId } });
    const stage = await app.prisma.pipelineStage.create({ data: { companyId: request.auth.companyId, pipelineId, position, ...input } });
    return reply.code(201).send({ data: stage });
  });
};
