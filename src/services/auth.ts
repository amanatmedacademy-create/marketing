import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
}

interface AuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  googleEnabled: boolean;
}

let clientPromise: Promise<SupabaseClient> | null = null;

export function getAuthClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = fetch('/api/auth/config')
      .then(async (response) => {
        const body = await response.text();
        if (!response.ok) throw new Error(body || 'Не удалось загрузить конфигурацию авторизации');
        return JSON.parse(body) as AuthConfig;
      })
      .then((config) => {
        if (!config.googleEnabled || !config.supabaseUrl || !config.supabaseAnonKey) {
          throw new Error('Google OAuth ещё не настроен в Supabase');
        }
        return createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
          },
        });
      });
  }
  return clientPromise;
}

export async function currentSession(): Promise<Session | null> {
  const client = await getAuthClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const session = await currentSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}

export async function loadAppUser(): Promise<AppUser> {
  const response = await authFetch('/api/auth/me');
  const body = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      throw new Error(parsed.error || body || 'Ошибка авторизации');
    } catch (error) {
      if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error;
      throw new Error(body || 'Ошибка авторизации');
    }
  }
  return (JSON.parse(body) as { user: AppUser }).user;
}
