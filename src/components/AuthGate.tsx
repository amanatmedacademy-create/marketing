import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { getAuthClient, loadAppUser, type AppUser } from '../services/auth';

interface AuthContextValue {
  user: AppUser;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Auth context is unavailable');
  return value;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const client = await getAuthClient();
      const { data } = await client.auth.getSession();
      if (!data.session) {
        setUser(null);
        return;
      }
      setUser(await loadAppUser());
    } catch (reason) {
      setUser(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | undefined;
    const nativeFetch = window.fetch.bind(window);

    getAuthClient()
      .then((client) => {
        window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          const isOwnApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
          if (!isOwnApi || url.includes('/api/auth/config')) return nativeFetch(input, init);

          const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has('authorization')) {
            const { data } = await client.auth.getSession();
            if (data.session?.access_token) headers.set('authorization', `Bearer ${data.session.access_token}`);
          }
          return nativeFetch(input, { ...init, headers });
        };

        subscription = client.auth.onAuthStateChange(() => { void refresh(); }).data.subscription;
        return refresh();
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });

    return () => {
      subscription?.unsubscribe();
      window.fetch = nativeFetch;
    };
  }, []);

  const signIn = async () => {
    setError(null);
    const client = await getAuthClient();
    const { error: signInError } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (signInError) setError(signInError.message);
  };

  const signOut = async () => {
    const client = await getAuthClient();
    await client.auth.signOut();
    setUser(null);
  };

  const context = useMemo(() => user ? { user, signOut } : null, [user]);

  if (loading) return <div className="auth-screen"><div className="auth-card"><div className="auth-logo"><ShieldCheck size={28}/></div><h1>AMANAT MED</h1><p>Проверяем сессию…</p></div></div>;

  if (!user || !context) return <div className="auth-screen">
    <div className="auth-card">
      <div className="auth-logo"><ShieldCheck size={30}/></div>
      <span>AMANAT MED</span>
      <h1>Рекламная аналитика</h1>
      <p>Вход и регистрация выполняются через Google. При первом входе аккаунт создаётся автоматически.</p>
      {error && <div className="auth-error">{error}</div>}
      <button className="google-login" onClick={signIn}><LogIn size={18}/>Продолжить через Google</button>
      <small>Доступ к данным предоставляется только авторизованным пользователям системы.</small>
    </div>
  </div>;

  return <AuthContext.Provider value={context}>
    <div className="auth-user-bar">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer"/> : <span>{user.name.slice(0,1).toUpperCase()}</span>}
      <div><b>{user.name}</b><small>{user.role}</small></div>
      <button onClick={() => void signOut()} title="Выйти"><LogOut size={16}/></button>
    </div>
    {children}
  </AuthContext.Provider>;
}
