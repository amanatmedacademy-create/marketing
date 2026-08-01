import type { AuthEnv } from './auth';

type GoogleSessionBody = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
};

type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

type Profile = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

const cookie = (name: string, value: string, maxAge