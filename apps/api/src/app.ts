import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import authPlugin from './plugins/auth.plugin.js';
import tenantPlugin from './plugins/tenant.plugin.js';

export function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true });

  app.decorate('prisma', prisma);
  app.register(sensible);
  app.register(cors, { origin: env.APP_ORIGIN, credentials: true });
  app.register(cookie);
  app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  app.register(authPlugin);
  app.register(tenantPlugin);
  app.register(authRoutes, { prefix: '/api/v1/auth' });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'imds-crm-api',
    auth: 'supabase',
    timestamp: new Date().toISOString(),
  }));

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.status(statusCode).send({
      error: {
        code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : error.message,
        message: statusCode === 500 ? 'Internal server error' : error.message,
      },
      requestId: request.id,
    });
  });

  return app;
}
