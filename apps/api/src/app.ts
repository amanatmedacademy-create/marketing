import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { env } from './config/env.js';

export function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true });

  app.register(cors, {
    origin: env.APP_ORIGIN,
    credentials: true,
  });

  app.register(cookie);
  app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'imds-crm-api',
    timestamp: new Date().toISOString(),
  }));

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

    return reply.status(statusCode).send({
      error: {
        code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : error.code ?? 'REQUEST_ERROR',
        message: statusCode === 500 ? 'Internal server error' : error.message,
      },
      requestId: request.id,
    });
  });

  return app;
}
