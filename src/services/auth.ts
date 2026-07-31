import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
}

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase Auth не настроен. Укажите VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

function mapUser(user: User): AppUser {
  const metadata = user.user_metadata ?? {};
  const fullName = typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string'
      ? metadata.name
      : user.email?.split('@')[0] ?? 'Пользователь';

  return {
    id: user.id,
    email: user.email ?? '',
    name: fullName,
    avatarUrl: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
    role: 'member',
    status: 'active',
  };
}

export async function currentSession(): Promise<Session | null> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function currentUser(): Promise<AppUser | null> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (error.status === 401 || error.status === 403) return null;
    throw error;
  }
  return data.user ? mapUser(data.user) : null;
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  const client = requireSupabase();
  return client.auth.onAuthStateChange(callback).data.subscription;
}

export async function startGoogleSignIn(): Promise<void> {
  const client = requireSupabase();
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });
  if (error) throw error;
}

export async function signOutSession(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const session = await currentSession();
  const headers = new Headers(init.headers ?? {});
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}

export async function loadAppUser(): Promise<AppUser> {
  const user = await currentUser();
  if (!user) throw new Error('Сессия Supabase недействительна');
  return user;
}
