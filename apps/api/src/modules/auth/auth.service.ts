import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { LoginInput, RegisterInput } from './auth.schemas.js';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '') || `company-${crypto.randomUUID().slice(0, 8)}`;
}

async function uniqueCompanySlug(prisma: PrismaClient, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let suffix = 1;
  while (await prisma.company.findUnique({ where: { slug }, select: { id: true } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

export async function register(app: FastifyInstance, input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  const existing = await app.prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw app.httpErrors.conflict('EMAIL_ALREADY_EXISTS');

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const slug = await uniqueCompanySlug(app.prisma, input.companyName);

  const result = await app.prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, firstName: input.firstName.trim(), lastName: input.lastName?.trim() || null },
    });
    const company = await tx.company.create({ data: { name: input.companyName.trim(), slug } });
    const membership = await tx.companyMember.create({
      data: { companyId: company.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
    });
    return { user, company, membership };
  });

  return issueSession(app, {
    userId: result.user.id,
    companyId: result.company.id,
    membershipId: result.membership.id,
    role: result.membership.role,
    locale: result.user.locale,
  });
}

export async function login(app: FastifyInstance, input: LoginInput) {
  const email = input.email.trim().toLowerCase();
  const user = await app.prisma.user.findUnique({
    where: { email },
    include: { memberships: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } },
  });
  if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, input.password))) {
    throw app.httpErrors.unauthorized('INVALID_CREDENTIALS');
  }
  const membership = user.memberships[0];
  if (!membership) throw app.httpErrors.forbidden('NO_ACTIVE_COMPANY');

  await app.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueSession(app, {
    userId: user.id,
    companyId: membership.companyId,
    membershipId: membership.id,
    role: membership.role,
    locale: user.locale,
  });
}

export async function issueSession(app: FastifyInstance, claims: {
  userId: string; companyId: string; membershipId: string; role: string; locale: string;
}) {
  const familyId = crypto.randomUUID();
  const rawRefreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);

  await app.prisma.refreshToken.create({
    data: {
      userId: claims.userId,
      companyId: claims.companyId,
      tokenHash: hashToken(rawRefreshToken),
      familyId,
      expiresAt,
    },
  });

  const accessToken = await app.jwt.sign({
    sub: claims.userId,
    companyId: claims.companyId,
    membershipId: claims.membershipId,
    role: claims.role,
    locale: claims.locale,
    type: 'access',
  }, { expiresIn: ACCESS_TTL_SECONDS });

  return { accessToken, refreshToken: rawRefreshToken, expiresIn: ACCESS_TTL_SECONDS };
}

export async function rotateRefreshToken(app: FastifyInstance, rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const stored = await app.prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
    if (stored?.familyId) {
      await app.prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    throw app.httpErrors.unauthorized('INVALID_REFRESH_TOKEN');
  }

  const membership = await app.prisma.companyMember.findFirst({
    where: { userId: stored.userId, companyId: stored.companyId ?? undefined, status: 'ACTIVE' },
    include: { user: true },
  });
  if (!membership) throw app.httpErrors.unauthorized('MEMBERSHIP_INACTIVE');

  const nextRaw = crypto.randomBytes(48).toString('base64url');
  const nextHash = hashToken(nextRaw);
  const nextId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);

  await app.prisma.$transaction([
    app.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date(), replacedById: nextId } }),
    app.prisma.refreshToken.create({
      data: { id: nextId, userId: stored.userId, companyId: membership.companyId, tokenHash: nextHash, familyId: stored.familyId, expiresAt },
    }),
  ]);

  const accessToken = await app.jwt.sign({
    sub: membership.userId,
    companyId: membership.companyId,
    membershipId: membership.id,
    role: membership.role,
    locale: membership.user.locale,
    type: 'access',
  }, { expiresIn: ACCESS_TTL_SECONDS });

  return { accessToken, refreshToken: nextRaw, expiresIn: ACCESS_TTL_SECONDS };
}

export async function revokeRefreshToken(app: FastifyInstance, rawToken: string) {
  await app.prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
}
