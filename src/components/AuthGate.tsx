import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  LineChart,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
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

function GoogleIcon() {
  return <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-1.99 3.02v2.55h3.23c1.89-1.74 2.98-4.3 2.98-7.42Z"/>
    <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.35l-3.23-2.55c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.07v2.63A10 10 0 0 0 12 22Z"/>
    <path fill="#FBBC05" d="M6.4 13.94A6 6 0 0 1 6.09 12c0-.67.12-1.32.31-1.94V7.43H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.57l3.33-2.63Z"/>
    <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.93 5.43l3.33 2.63C7.19 7.7 9.4 5.94 12 5.94Z"/>
  </svg>;
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    administrator: 'Администратор',
    marketer: 'Маркетолог',
    analyst: 'Аналитик',
    viewer: 'Наблюдатель',
  };
  return labels[role] || role;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const client = await getAuthClient();
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      setHasSession(Boolean(data.session));
      if (!data.session) {
        setUser(null);
        return;
      }
      setUser(await loadAppUser());
      setError(null);
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

    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const oauthError = searchParams.get('error_description') || hashParams.get('error_description');
    if (oauthError) setError(oauthError);

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

        subscription = client.auth.onAuthStateChange((_event, session) => {
          setHasSession(Boolean(session));
          void refresh(false);
        }).data.subscription;
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
    setSigningIn(true);
    setError(null);
    try {
      const client = await getAuthClient();
      const { error: signInError } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          scopes: 'openid email profile',
          queryParams: { prompt: 'select_account' },
        },
      });
      if (signInError) throw signInError;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    const client = await getAuthClient();
    await client.auth.signOut();
    setUser(null);
    setHasSession(false);
    setError(null);
  };

  const context = useMemo(() => user ? { user, signOut } : null, [user]);

  if (loading) return <div className="auth-screen auth-screen--loading">
    <div className="auth-loading-card">
      <div className="auth-brand-mark"><LineChart size={27}/></div>
      <span>AMANAT MED</span>
      <LoaderCircle className="spin" size={25}/>
      <p>Проверяем защищённую сессию</p>
    </div>
  </div>;

  if (!user || !context) return <div className="auth-screen">
    <div className="auth-orb auth-orb--one"/>
    <div className="auth-orb auth-orb--two"/>
    <div className="auth-layout">
      <section className="auth-showcase">
        <div className="auth-brand">
          <div className="auth-brand-mark"><LineChart size={24}/></div>
          <div><b>AMANAT MED</b><span>Marketing Intelligence</span></div>
        </div>

        <div className="auth-copy">
          <div className="auth-eyebrow"><Sparkles size={14}/>Сквозная рекламная аналитика</div>
          <h1>Маркетинг, CRM и продажи — в одном контуре</h1>
          <p>Контролируйте расходы, качество лидов, приходы, продажи и ROAS по каждому источнику и рекламной кампании.</p>
        </div>

        <div className="auth-benefits">
          <div><CheckCircle2 size={17}/><span>Рекламные кабинеты и Bitrix24</span></div>
          <div><CheckCircle2 size={17}/><span>Полная CRM-воронка до покупки</span></div>
          <div><CheckCircle2 size={17}/><span>Автоматические рекомендации по кампаниям</span></div>
        </div>

        <div className="auth-preview" aria-hidden="true">
          <header><span>Результаты за 7 дней</span><i>Live data</i></header>
          <div className="auth-preview-kpis">
            <div><small>Лиды</small><b>181</b><em>+10%</em></div>
            <div><small>Продажи</small><b>51</b><em>28%</em></div>
            <div><small>ROAS</small><b>3.2x</b><em>Норма</em></div>
          </div>
          <div className="auth-preview-chart">
            {[38, 52, 45, 70, 49, 64, 58, 82, 68, 88, 76, 94].map((height, index) => <i key={index} style={{ height: `${height}%` }}/>) }
          </div>
        </div>
      </section>

      <section className="auth-login-panel">
        <div className="auth-login-card">
          <div className="auth-login-icon"><ShieldCheck size={28}/></div>
          <span className="auth-login-product">AMANAT MED</span>
          <h2>Вход в систему</h2>
          <p>Используйте рабочий Google-аккаунт. При первом входе профиль будет зарегистрирован автоматически.</p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button className="google-login" onClick={() => void signIn()} disabled={signingIn}>
            {signingIn ? <LoaderCircle className="spin" size={20}/> : <GoogleIcon/>}
            <span>{signingIn ? 'Переходим в Google…' : 'Продолжить через Google'}</span>
            {!signingIn && <ArrowRight size={17}/>} 
          </button>

          {hasSession && error && <button className="auth-secondary-action" onClick={() => void signOut()}>
            Выйти и выбрать другой аккаунт
          </button>}

          <div className="auth-security-note"><LockKeyhole size={15}/><span>Данные доступны только авторизованным пользователям. Пароль Google не передаётся AMANAT MED.</span></div>
          <small className="auth-terms">Продолжая, вы соглашаетесь с правилами доступа к внутренней аналитике компании.</small>
        </div>
        <p className="auth-support">Проблемы со входом? Обратитесь к администратору системы.</p>
      </section>
    </div>
  </div>;

  return <AuthContext.Provider value={context}>
    <div className="auth-user-bar">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer"/> : <span>{user.name.slice(0, 1).toUpperCase()}</span>}
      <div><b>{user.name}</b><small>{roleLabel(user.role)}</small></div>
      <button onClick={() => void signOut()} title="Выйти"><LogOut size={16}/></button>
    </div>
    {children}
  </AuthContext.Provider>;
}
