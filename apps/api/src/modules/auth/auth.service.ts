import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@imds/database';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { JwtPayload } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, context: { ip?: string; userAgent?: string }) {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email уже зарегистрирован');

    const passwordHash = await argon2.hash(dto.password);
    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: dto.companyName.trim(), slug: dto.companySlug.trim().toLowerCase() },
      });
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          status: UserStatus.ACTIVE,
        },
      });
      await tx.companyMember.create({ data: { companyId: company.id, userId: user.id, role: UserRole.OWNER } });
      return { company, user, role: UserRole.OWNER };
    });

    return this.createSession(result.user.id, result.company.id, result.role, context);
  }

  async login(dto: LoginDto, context: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { memberships: { include: { company: true }, orderBy: { joinedAt: 'asc' }, take: 1 } },
    });
    if (!user || user.status !== UserStatus.ACTIVE || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Неверный email или пароль');
    }
    const membership = user.memberships[0];
    if (!membership) throw new UnauthorizedException('Нет доступа к компании');
    return this.createSession(user.id, membership.companyId, membership.role, context);
  }

  async refresh(rawToken: string | undefined, context: { ip?: string; userAgent?: string }) {
    if (!rawToken) throw new UnauthorizedException('Refresh token отсутствует');
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(rawToken, { secret: this.refreshSecret() });
    } catch {
      throw new UnauthorizedException('Refresh token недействителен');
    }
    const session = await this.prisma.authSession.findUnique({ where: { id: payload.sessionId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !(await argon2.verify(session.refreshTokenHash, rawToken))) {
      throw new UnauthorizedException('Сессия недействительна');
    }
    await this.prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.createSession(payload.sub, payload.companyId, payload.role, context);
  }

  async logout(sessionId: string) {
    await this.prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(payload: JwtPayload) {
    const membership = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId: payload.companyId, userId: payload.sub } },
      include: { user: true, company: true },
    });
    if (!membership) throw new UnauthorizedException();
    return {
      user: { id: membership.user.id, email: membership.user.email, firstName: membership.user.firstName, lastName: membership.user.lastName, locale: membership.user.locale },
      company: { id: membership.company.id, name: membership.company.name, slug: membership.company.slug, timezone: membership.company.timezone, locale: membership.company.locale, currency: membership.company.currency },
      role: membership.role,
      permissions: membership.permissions,
    };
  }

  private async createSession(userId: string, companyId: string, role: UserRole, context: { ip?: string; userAgent?: string }) {
    const sessionId = randomUUID();
    const payload: JwtPayload = { sub: userId, companyId, role, sessionId };
    const accessToken = await this.jwt.signAsync(payload, { secret: this.accessSecret(), expiresIn: '15m' });
    const refreshToken = await this.jwt.signAsync(payload, { secret: this.refreshSecret(), expiresIn: '30d' });
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        companyId,
        refreshTokenHash: await argon2.hash(refreshToken),
        ipAddress: context.ip,
        userAgent: context.userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken, expiresIn: 900 };
  }

  private accessSecret() { return this.config.getOrThrow<string>('JWT_ACCESS_SECRET'); }
  private refreshSecret() { return this.config.getOrThrow<string>('JWT_REFRESH_SECRET'); }
}
