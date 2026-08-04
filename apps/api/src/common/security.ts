import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DataSource, EntityManager } from 'typeorm';

export type RequestPrincipal = { subject: string; email?: string; claims: Record<string, unknown> };
export type TenantRequest = { headers: Record<string, string | string[] | undefined>; principal?: RequestPrincipal; agencyId?: string };

export const Public = () => SetMetadata('isPublic', true);
export const CurrentAgency = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<TenantRequest>().agencyId;
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly config: ConfigService, private readonly reflector: Reflector) {
    const jwksUrl = this.config.getOrThrow<string>('SUPABASE_JWKS_URL');
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const authorization = request.headers.authorization;
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token is required');
    const token = value.slice(7);
    const issuer = this.config.get<string>('SUPABASE_JWT_ISSUER');
    const verified = await jwtVerify(token, this.jwks, issuer ? { issuer } : undefined);
    request.principal = {
      subject: verified.payload.sub ?? '',
      email: typeof verified.payload.email === 'string' ? verified.payload.email : undefined,
      claims: verified.payload as Record<string, unknown>,
    };
    if (!request.principal.subject) throw new UnauthorizedException('Token subject is missing');
    return true;
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly db: DataSource, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const raw = request.headers['x-agency-id'];
    const agencyId = Array.isArray(raw) ? raw[0] : raw;
    if (!agencyId || !/^[0-9a-f-]{36}$/i.test(agencyId)) throw new UnauthorizedException('Valid x-agency-id is required');
    const rows = await this.db.query('select analytics.is_agency_member($1, $2) as allowed', [request.principal?.subject, agencyId]);
    if (!rows[0]?.allowed) throw new UnauthorizedException('Agency access denied');
    request.agencyId = agencyId;
    return true;
  }
}

@Injectable()
export class TenantDbService {
  constructor(private readonly db: DataSource) {}

  async run<T>(agencyId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query("select set_config('app.agency_id', $1, true)", [agencyId]);
      const result = await work(runner.manager);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}
