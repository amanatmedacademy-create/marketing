import fp from 'fastify-plugin';
import { createClient, type User as SupabaseUser } from '@supabase/supabase-js';
import type { FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

export type IdentityContext = {
  userId: string;
  supabaseUserId: string;
  locale: 'KK' | 'RU' | 'EN';
};

export type AuthContext = IdentityContext & {
  companyId: string;
  membershipId: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER';
};

function bearerToken(request: FastifyRequest): string {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) throw request.server.httpErrors.unauthorized('ACCESS_TOKEN_REQUIRED');
  return value.slice(7).trim();
}

function profileFrom(user: SupabaseUser) {
  const metadata = user.user_metadata ?? {};
  const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '';
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || (typeof metadata.name === 'string' ? metadata.name : user.email?.split('@')[0]) || 'User',
    lastName: parts.slice(1).join(' ') || null,
    avatarUrl: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
  };
}

export default fp(async (app) => {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  app.decorateRequest('identity', null);
  app.decorateRequest('auth', null);

  app.decorate('authenticateIdentity', async (request: FastifyRequest) => {
    const token = bearerToken(request);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.email) throw app.httpErrors.unauthorized('INVALID_SUPABASE_TOKEN');

    const profile = profileFrom(data.user);
    const localUser = await app.prisma.user.upsert({
      where: { supabaseUserId: data.user.id },
      update: {
        email: data.user.email.toLowerCase(),
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        lastLoginAt: new Date(),
      },
      create: {
        supabaseUserId: data.user.id,
        email: data.user.email.toLowerCase(),
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        emailVerifiedAt: data.user.email_confirmed_at ? new Date(data.user.email_confirmed_at) : null,
        lastLoginAt: new Date(),
      },
    });

    request.identity = {
      userId: localUser.id,
      supabaseUserId: data.user.id,
      locale: localUser.locale,
    };
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    await app.authenticateIdentity(request);
    const requestedCompanyId = request.headers['x-company-id'];
    const membership = await app.prisma.companyMember.findFirst({
      where: {
        userId: request.identity.userId,
        status: 'ACTIVE',
        ...(typeof requestedCompanyId === 'string' ? { companyId: requestedCompanyId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw app.httpErrors.forbidden('NO_ACTIVE_COMPANY_MEMBERSHIP');

    request.auth = {
      ...request.identity,
      companyId: membership.companyId,
      membershipId: membership.id,
      role: membership.role,
    };
  });
});

declare module 'fastify' {
  interface FastifyRequest {
    identity: IdentityContext;
    auth: AuthContext;
  }
  interface FastifyInstance {
    authenticateIdentity: (request: FastifyRequest) => Promise<void>;
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}
