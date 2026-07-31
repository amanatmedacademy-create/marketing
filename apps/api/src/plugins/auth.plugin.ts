import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';

export type AuthContext = {
  userId: string;
  companyId: string;
  membershipId: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER';
  locale: 'KK' | 'RU' | 'EN';
};

export default fp(async (app) => {
  app.decorateRequest('auth', null);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const payload = await request.jwtVerify<{
      sub: string; companyId: string; membershipId: string; role: AuthContext['role']; locale: AuthContext['locale']; type: string;
    }>();
    if (payload.type !== 'access') throw app.httpErrors.unauthorized('INVALID_ACCESS_TOKEN');
    request.auth = {
      userId: payload.sub,
      companyId: payload.companyId,
      membershipId: payload.membershipId,
      role: payload.role,
      locale: payload.locale,
    };
  });
});

declare module 'fastify' {
  interface FastifyRequest { auth: AuthContext }
  interface FastifyInstance { authenticate: (request: FastifyRequest) => Promise<void> }
}
