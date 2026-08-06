import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  LineChart,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import {
  consumeGoogleAuthIntent,
  currentSession,
  loadAppUser,
  signOutSession,
  startGoogleAuth,
  type AppUser,
  type GoogleAuthIntent,
} from '../services/auth';

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

function initialAuthMode(): GoogleAuthIntent {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'register' ? 'signup' : 'login';
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<GoogleAuthIntent>(initialAuthMode);
  const [activeIntent, setActiveIntent] = useState<GoogleAuthIntent | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const nativeFetch = window.fetch.bind(window);

    const searchParams = new URLSearchParams(window.location.search);
    const oauthError = searchParams.get('error_description');
    if (oauthError) setError(oauthError);

    window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const isOwnApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
      if (!isOwnApi || url.includes('/api/auth/')) return nativeFetch(input, init);

      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('authorization')) {
        const session = await currentSession();
        if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
      }
      return nativeFetch(input, { ...init, headers });
    };

    const intent = consumeGoogleAuthIntent();
    if (intent === 'signup') setMode('signup');

    currentSession()
      .then(async (session) => {
        if (!active) return;
        setHasSession(Boolean(session));
        if (!session) return;

        const result = await loadAppUser(intent);
        if (!active) return;

        if (result.pending) {
          setMode('signup');
          setNotice(result.message || 'Регистрация завершена. Аккаунт ожидает подтверждения администратора.');
          return;
        }

        if (result.user) {
          setUser(result.user);
          setError(null);
        }
      })
      .catch((reason) => {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message.includes('Пользователь не зарегистрирован')) setMode('signup');
        setError(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.fetch = nativeFetch;
    };
  }, []);

  const selectMode = (nextMode: GoogleAuthIntent) => {
    if (activeIntent) return;
    setMode(nextMode);
    setError(null);
    setNotice(null);

    const url = new URL(window.location.href);
    url.searchParams.delete('error_description');
    url.searchParams.delete('auth_intent');
    url.searchParams.set('mode', nextMode === 'signup' ? 'register' : 'login');
    history.replaceState({}, document.title, `${url.pathname}?${url.searchParams.toString()}`);
  };

  const startAuth = async () => {
    setActiveIntent(mode);
    setError(null);
    setNotice(null);
    try {
      await startGoogleAuth(mode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setActiveIntent(null);
    }
  };

  const signOut = async () => {
    await signOutSession();
    setUser(null);
    setHasSession(false);
    setError(null);
    setNotice(null);
    setActiveIntent(null);
  };

  const context = useMemo(() => user ? { user, signOut } : null, [user]);
  const isRegistration = mode === 'signup';

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
          <div className="auth-mode-tabs" role="tablist" aria-label="Авторизация">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegistration}
              className={!isRegistration ? 'active' : ''}
              onClick={() => selectMode('login')}
              disabled={activeIntent !== null}
            >Вход</button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegistration}
              className={isRegistration ? 'active' : ''}
              onClick={() => selectMode('signup')}
              disabled={activeIntent !== null}
            >Регистрация</button>
          </div>

          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void startAuth(); }} aria-busy={activeIntent !== null}>
            <div className={`auth-login-icon${isRegistration ? ' auth-login-icon--register' : ''}`}>
              {isRegistration ? <UserPlus size={28}/> : <ShieldCheck size={28}/>} 
            </div>
            <span className="auth-login-product">AMANAT MED</span>
            <h2>{isRegistration ? 'Создать аккаунт' : 'Вход в систему'}</h2>
            <p className="auth-mode-lead">
              {isRegistration
                ? 'Зарегистрируйтесь с разрешённым Google-аккаунтом. Пароль создавать не требуется.'
                : 'Войдите через Google-аккаунт, который уже зарегистрирован в системе.'}
            </p>

            {error && <div className="auth-error" role="alert">{error}</div>}
            {notice && <div className="auth-notice" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}

            {isRegistration && <div className="auth-registration-steps">
              <div><span>1</span><p><b>Выберите Google-аккаунт</b><small>Используйте разрешённый корпоративный или одобренный адрес.</small></p></div>
              <div><span>2</span><p><b>Подтвердите профиль</b><small>Имя, email и фотография будут получены из Google.</small></p></div>
              <div><span>3</span><p><b>Получите доступ</b><small>Администратор активируется сразу; остальные аккаунты проходят подтверждение.</small></p></div>
            </div>}

            <button className="google-login" type="submit" disabled={activeIntent !== null}>
              {activeIntent === mode ? <LoaderCircle className="spin" size={20}/> : <GoogleIcon/>}
              <span>
                {activeIntent === mode
                  ? 'Открываем Google…'
                  : isRegistration ? 'Зарегистрироваться через Google' : 'Войти через Google'}
              </span>
              {activeIntent !== mode && <ArrowRight size={17}/>} 
            </button>

            <div className="auth-mode-switch">
              <span>{isRegistration ? 'Уже есть аккаунт?' : 'Ещё нет аккаунта?'}</span>
              <button type="button" onClick={() => selectMode(isRegistration ? 'login' : 'signup')} disabled={activeIntent !== null}>
                {isRegistration ? 'Войти' : 'Зарегистрироваться'}
              </button>
            </div>

            {hasSession && (error || notice) && <button className="auth-secondary-action" type="button" onClick={() => void signOut()}>
              Выйти из текущей сессии и выбрать другой аккаунт
            </button>}
          </form>

          <div className="auth-security-note"><LockKeyhole size={15}/><span>Пароль Google не передаётся AMANAT MED. Доступ предоставляется только разрешённым аккаунтам.</span></div>
          <small className="auth-terms">Продолжая, вы соглашаетесь с правилами доступа к внутренней аналитике компании.</small>
        </div>
        <p className="auth-support">Проблемы со входом? Обратитесь к администратору системы.</p>
      </section>
    </div>
  </div>;

  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}
