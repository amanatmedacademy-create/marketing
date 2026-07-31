import fp from 'fastify-plugin';
import type { Prisma, PrismaClient } from '@prisma/client';

export default fp(async (app) => {
  app.decorate('withTenant', async <T>(companyId: string, callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
    return app.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
      return callback(tx);
    });
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    withTenant<T>(companyId: string, callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  }
}
