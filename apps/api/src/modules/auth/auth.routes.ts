import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { createCompanySchema, switchCompanySchema } from './company.schemas.js';

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '');
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/bootstrap', { preHandler: app.authenticateIdentity }, async (request) => {
    const memberships = await app.prisma.companyMember.findMany({
      where: { userId: request.identity.userId, status: 'ACTIVE' },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      data: {
        identity: request.identity,
        requiresOnboarding: memberships.length === 0,
        companies: memberships.map((m) => ({
          id: m.company.id,
          name: m.company.name,
          slug: m.company.slug,
          timezone: m.company.timezone,
          locale: m.company.locale,
          role: m.role,
        })),
      },
    };
  });

  app.post('/companies', { preHandler: app.authenticateIdentity }, async (request, reply) => {
    const input = createCompanySchema.parse(request.body);
    const existingMembership = await app.prisma.companyMember.findFirst({
      where: { userId: request.identity.userId },
      select: { id: true },
    });
    if (existingMembership) throw app.httpErrors.conflict('COMPANY_ALREADY_EXISTS_FOR_ONBOARDING');

    const base = slugify(input.name) || 'company';
    let slug = base;
    while (await app.prisma.company.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    }

    const result = await app.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: input.name, slug, timezone: input.timezone, locale: input.locale },
      });
      const membership = await tx.companyMember.create({
        data: {
          companyId: company.id,
          userId: request.identity.userId,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
      return { company, membership };
    });

    return reply.code(201).send({
      data: {
        company: result.company,
        membership: { id: result.membership.id, role: result.membership.role },
      },
    });
  });

  app.post('/switch-company', { preHandler: app.authenticateIdentity }, async (request) => {
    const input = switchCompanySchema.parse(request.body);
    const membership = await app.prisma.companyMember.findFirst({
      where: { userId: request.identity.userId, companyId: input.companyId, status: 'ACTIVE' },
      include: { company: true },
    });
    if (!membership) throw app.httpErrors.forbidden('COMPANY_ACCESS_DENIED');
    return {
      data: {
        company: membership.company,
        membership: { id: membership.id, role: membership.role },
      },
    };
  });

  app.get('/session', { preHandler: app.authenticate }, async (request) => ({ data: request.auth }));
};
