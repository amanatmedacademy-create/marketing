import { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { createDealSchema, moveDealSchema } from './deal.schemas.js';

const GAP = new Prisma.Decimal(1024);

export const dealRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const query = request.query as { pipelineId?: string; stageId?: string; search?: string; limit?: string };
    return { data: await app.prisma.deal.findMany({
      where: {
        companyId: request.auth.companyId,
        deletedAt: null,
        ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
        ...(query.stageId ? { stageId: query.stageId } : {}),
        ...(query.search ? { OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ] } : {}),
      },
      include: { contact: true, assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }, stage: true },
      orderBy: [{ stageId: 'asc' }, { position: 'asc' }],
      take: Math.min(Number(query.limit || 200), 500),
    }) };
  });

  app.post('/', async (request, reply) => {
    const input = createDealSchema.parse(request.body);
    const stage = await app.prisma.pipelineStage.findFirst({ where: { id: input.stageId, pipelineId: input.pipelineId, companyId: request.auth.companyId } });
    if (!stage) throw app.httpErrors.badRequest('INVALID_PIPELINE_STAGE');
    const last = await app.prisma.deal.findFirst({ where: { companyId: request.auth.companyId, stageId: input.stageId, deletedAt: null }, orderBy: { position: 'desc' } });
    const deal = await app.prisma.deal.create({ data: {
      companyId: request.auth.companyId,
      ...input,
      oneTimeAmount: new Prisma.Decimal(input.oneTimeAmount),
      recurringAmount: new Prisma.Decimal(input.recurringAmount),
      position: last ? last.position.add(GAP) : GAP,
    } });
    return reply.code(201).send({ data: deal });
  });

  app.post('/:id/move', async (request) => {
    const { id } = request.params as { id: string };
    const input = moveDealSchema.parse(request.body);
    const deal = await app.prisma.deal.findFirst({ where: { id, companyId: request.auth.companyId, deletedAt: null } });
    if (!deal) throw app.httpErrors.notFound('DEAL_NOT_FOUND');
    if (input.expectedUpdatedAt && deal.updatedAt.toISOString() !== input.expectedUpdatedAt) throw app.httpErrors.conflict('DEAL_CHANGED');

    const targetStage = await app.prisma.pipelineStage.findFirst({ where: { id: input.targetStageId, companyId: request.auth.companyId } });
    if (!targetStage) throw app.httpErrors.notFound('STAGE_NOT_FOUND');

    const [before, after] = await Promise.all([
      input.beforeDealId ? app.prisma.deal.findFirst({ where: { id: input.beforeDealId, stageId: input.targetStageId, companyId: request.auth.companyId } }) : null,
      input.afterDealId ? app.prisma.deal.findFirst({ where: { id: input.afterDealId, stageId: input.targetStageId, companyId: request.auth.companyId } }) : null,
    ]);

    let position = GAP;
    if (before && after) position = before.position.add(after.position).div(2);
    else if (before) position = before.position.add(GAP);
    else if (after) position = after.position.div(2);
    else {
      const last = await app.prisma.deal.findFirst({ where: { companyId: request.auth.companyId, stageId: input.targetStageId, deletedAt: null, NOT: { id } }, orderBy: { position: 'desc' } });
      position = last ? last.position.add(GAP) : GAP;
    }

    const status = targetStage.isWon ? 'WON' : targetStage.isLost ? 'LOST' : 'OPEN';
    return { data: await app.prisma.deal.update({ where: { id }, data: {
      pipelineId: targetStage.pipelineId,
      stageId: targetStage.id,
      position,
      status,
      wonAt: targetStage.isWon ? new Date() : null,
      lostAt: targetStage.isLost ? new Date() : null,
      lastActivityAt: new Date(),
    } }) };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.prisma.deal.updateMany({ where: { id, companyId: request.auth.companyId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw app.httpErrors.notFound('DEAL_NOT_FOUND');
    return reply.code(204).send();
  });
};
