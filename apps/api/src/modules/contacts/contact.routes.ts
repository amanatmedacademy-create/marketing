import type { FastifyPluginAsync } from 'fastify';
import { createContactSchema } from './contact.schemas.js';

export const contactRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const query = request.query as { search?: string; limit?: string };
    const limit = Math.min(Number(query.limit || 50), 100);
    return { data: await app.prisma.contact.findMany({
      where: {
        companyId: request.auth.companyId,
        deletedAt: null,
        ...(query.search ? { OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) };
  });

  app.post('/', async (request, reply) => {
    const input = createContactSchema.parse(request.body);
    const contact = await app.prisma.contact.create({ data: { companyId: request.auth.companyId, ...input } });
    return reply.code(201).send({ data: contact });
  });
};
