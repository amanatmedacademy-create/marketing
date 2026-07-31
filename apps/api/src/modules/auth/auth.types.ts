import type { UserRole } from '@imds/database';

export type JwtPayload = {
  sub: string;
  companyId: string;
  role: UserRole;
  sessionId: string;
};
