import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, registerSchema } from './auth.schemas.js';
import { login, register, revokeRefreshToken, rotateRefreshToken } from './auth.service.js';

const REFRESH_COOKIE = 'crm_refresh';
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60,
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', async (request, reply) => {
    const session = await register(app, registerSchema.parse(request.body));
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, cookieOptions);
    return reply.code(201).send({ data: { accessToken: session.accessToken, expiresIn: session.expiresIn } });
  });

  app.post('/login', async (request, reply) => {
    const session = await login(app, loginSchema.parse(request.body));
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, cookieOptions);
    return { data: { accessToken: session.accessToken, expiresIn: session.expiresIn } };
  });

  app.post('/refresh', async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE];
    if (!rawToken) throw app.httpErrors.unauthorized('REFRESH_TOKEN_REQUIRED');
    const session = await rotateRefreshToken(app, rawToken);
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, cookieOptions);
    return { data: { accessToken: session.accessToken, expiresIn: session.expiresIn } };
  });

  app.post('/logout', async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE];
    if (rawToken) await revokeRefreshToken(app, rawToken);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return reply.code(204).send();
  });

  app.get('/session', { preHandler: app.authenticate }, async (request) => ({ data: request.auth }));
};
