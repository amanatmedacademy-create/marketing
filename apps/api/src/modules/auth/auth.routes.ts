import type { FastifyPluginAsync } from 'fastify';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/session', { preHandler: app.authenticate }, async (request) => ({
    data: request.auth,
  }));

  app.get('/companies', { preHandler: app.authenticate }, async (request) => {
    const memberships = await app.prisma.companyMember.findMany({
      where: { userId: request.auth.userId, status: 'ACTIVE' },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      data: memberships.map((membership) => ({
        id: membership.company.id,
        name: membership.company.name,
        slug: membership.company.slug,
        timezone: membership.company.timezone,
        locale: membership.company.locale,
        role: membership.role,
      })),
    };
  });
};
