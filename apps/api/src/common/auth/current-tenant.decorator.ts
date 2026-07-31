import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@imds/database';

export type TenantPrincipal = {
  sub: string;
  companyId: string;
  role: UserRole;
  sessionId: string;
};

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantPrincipal => {
    const request = context.switchToHttp().getRequest<{ user: TenantPrincipal }>();
    return request.user;
  },
);
