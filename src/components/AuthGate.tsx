import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import ImdsBrand from './ImdsBrand';
import {
  activeCompanyId,
  currentSession,
  loadAppUser,
  registerNativeAccount,
  setActiveCompanyId,
  signInWithPassword,
  signOutSession,
  startGoogleSignIn,
  type AppUser,
  type UserCompany,
} from '../services/auth';

interface AuthContextValue {
  user: AppUser;
  signOut: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
}

type AuthMode = 'login' | 'register';
type RegistrationMode = 'new_company' | 'join_company';

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

function CompanyPicker({ companies, onSelect, busy }: { companies: UserCompany[]; onSelect: (id: string) => void; busy: boolean }) {
  return <div className="auth-screen">
    <div className="auth-orb auth-orb--one"/><div className="auth-orb auth-orb--two"/>
    <section className="auth-login-panel" style={{ margin: 'auto', minHeight: '100vh' }}>
      <div className="auth-login-card">
        <div className="auth-login-icon"><Building2 size={28}/></div>
        <span className="auth-login-product">IMDS TECH</span>
        <h2>Выберите организацию</h2>
        <p>Данные, сотрудники, интеграции и реклама открываются только в контексте выбранной организации.</p>
        <div className="auth-company-list">
          {companies.map((company) => <button key={company.id} type="button" className="google-login" disabled={busy} onClick={() => onSelect(company.id)}>
            <Building2 size={19}/><span>{company.name}<small>{company.role}</small></span><ArrowRight size={17}/>
          </button>)}
        </div>
        <div className="auth-security-note"><ShieldCheck size={15}/><span>Сервер проверяет членство пользователя при каждом переключении организации.</span></div>
      </div>
    </section>
  </div>;
}

function PendingOrganization({ user, onSignOut }: { user: AppUser; onSignOut: () => Promise<void> }) {
  return <div className="auth-screen auth-screen--loading">
    <div className="auth-login-card auth-pending-card">
      <div className="auth-login-icon"><ShieldCheck size={28}/></div>
      <span className="auth-login-product">IMDS MARKETING</span>
      <h2>Регистрация организации</h2>
      <p>{user.onboardingStatus === 'pending_approval'
        ? 'Заявка отправлена администратору организации. После одобрения откроются назначенные модули.'
        : 'Для этого аккаунта ещё не завершено подключение к организации.'}</p>
      <div className="auth-security-note"><Mail size={15}/><span>{user.email}</span></div>
      <button className="auth-secondary-action" onClick={() => void onSignOut()}>Выйти</button>
    </div>
  </div>;
}

function LoginPanel({ onAuthenticated, error, setError }: { onAuthenticated: (user: AppUser) => void; error: string | null; setError: (value: string | null) => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('new_company');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const google = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await startGoogleSignIn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const normalizedEmail = email.trim().toLowerCase();
    const phoneDigits = phone.replace(/\D/g, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError('Введите корректный email.'); return; }
    if (password.length < 10) { setError('Пароль должен содержать минимум 10 символов.'); return; }
    if (mode === 'register' && password !== confirmPassword) { setError('Пароли не совпадают.'); return; }
    if (mode === 'register' && displayName.trim().length < 2) { setError('Укажите имя пользователя.'); return; }
    if (mode === 'register' && (phoneDigits.length < 10 || phoneDigits.length > 15)) { setError('Введите корректный номер телефона.'); return; }
    if (mode === 'register' && registrationMode === 'new_company' && companyName.trim().length < 2) { setError('Укажите название организации.'); return; }
    if (mode === 'register' && registrationMode === 'join_company' && companyCode.trim().length < 6) { setError('Введите код организации.'); return; }

    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await signInWithPassword(normalizedEmail, password, remember);
      } else {
        await registerNativeAccount({
          email: normalizedEmail,
          phone,
          password,
          displayName,
          mode: registrationMode,
          companyName: registrationMode === 'new_company' ? companyName : undefined,
          companyCode: registrationMode === 'join_company' ? companyCode : undefined,
          remember,
        });
      }
      onAuthenticated(await loadAppUser());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return <section className="auth-login-panel">
    <form className="auth-login-card" onSubmit={submit}>
      <div className="auth-login-icon"><ShieldCheck size={28}/></div>
      <span className="auth-login-product">IMDS MARKETING</span>
      <h2>{mode === 'login' ? 'Вход в IMDS' : 'Регистрация'}</h2>
      <p>{mode === 'login' ? 'Введите email и пароль своей учётной записи.' : 'Создайте аккаунт и выберите способ подключения организации.'}</p>

      <div className="auth-tabs">
        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(null); }}>Вход</button>
        <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(null); }}>Регистрация</button>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {mode === 'register' && <div className="auth-registration-choice">
        <button type="button" className={registrationMode === 'new_company' ? 'active' : ''} onClick={() => setRegistrationMode('new_company')}>
          <Building2 size={18}/><span><strong>Новая организация</strong><small>Создам отдельный рабочий контур</small></span>
        </button>
        <button type="button" className={registrationMode === 'join_company' ? 'active' : ''} onClick={() => setRegistrationMode('join_company')}>
          <KeyRound size={18}/><span><strong>Есть код организации</strong><small>Подключусь к существующей организации</small></span>
        </button>
      </div>}

      {mode === 'register' && <label className="auth-field"><span>Имя</span><div><UserRound size={17}/><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="Имя и фамилия" disabled={busy}/></div></label>}
      {mode === 'register' && registrationMode === 'new_company' && <label className="auth-field"><span>Название организации</span><div><Building2 size={17}/><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Например: Amanat Clinic" disabled={busy}/></div></label>}
      {mode === 'register' && registrationMode === 'join_company' && <label className="auth-field"><span>Код организации</span><div><KeyRound size={17}/><input value={companyCode} onChange={(e) => setCompanyCode(e.target.value.toUpperCase())} autoCapitalize="characters" placeholder="IMDS-XXXX-XXXX" disabled={busy}/></div></label>}
      {mode === 'register' && <label className="auth-field"><span>Телефон</span><div><Phone size={17}/><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="+7 700 000 00 00" disabled={busy}/></div></label>}

      <label className="auth-field"><span>Email</span><div><Mail size={17}/><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="name@example.com" disabled={busy}/></div></label>
      <label className="auth-field"><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Минимум 10 символов" disabled={busy}/></div></label>
      {mode === 'register' && <label className="auth-field"><span>Повторите пароль</span><div><LockKeyhole size={17}/><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" disabled={busy}/></div></label>}

      <label className="auth-remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy}/><span>Оставаться в системе</span></label>
      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={19}/> : mode === 'login' ? <LockKeyhole size={18}/> : <UserRound size={18}/>}<span>{busy ? 'Проверяем данные…' : mode === 'login' ? 'Войти в систему' : 'Создать аккаунт'}</span>
      </button>

      <div className="auth-divider"><span>или</span></div>
      <button className="google-login" type="button" onClick={() => void google()} disabled={busy}>
        <GoogleIcon/><span>Продолжить через Google</span><ArrowRight size={17}/>
      </button>
      <div className="auth-security-note"><ShieldCheck size={15}/><span>Пароли хранятся только в виде стойких хешей. Доступ к данным определяется организацией, ролью и персональными правами.</span></div>
    </form>
  </section>;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const nativeFetch = window.fetch.bind(window);
    const searchParams = new URLSearchParams(window.location.search);
    const oauthError = searchParams.get('error_description');
    if (oauthError) {
      setError(oauthError);
      history.replaceState({}, document.title, window.location.pathname);
    }

    window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const isOwnApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
      if (!isOwnApi || url.includes('/api/auth/')) return nativeFetch(input, init);
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('authorization')) {
        const session = await currentSession();
        if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
      }
      const companyId = activeCompanyId();
      if (companyId && !headers.has('x-imds-company-id')) headers.set('x-imds-company-id', companyId);
      return nativeFetch(input, { ...init, headers });
    };

    currentSession().then(async (session) => {
      if (!active || !session) return;
      const appUser = await loadAppUser();
      if (active) {
        setUser(appUser);
        setError(null);
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      window.fetch = nativeFetch;
    };
  }, []);

  const signOut = async () => {
    await signOutSession();
    setUser(null);
    setError(null);
  };

  const switchCompany = async (companyId: string) => {
    if (!companyId || switching) return;
    const previous = activeCompanyId();
    setSwitching(true);
    setError(null);
    try {
      setActiveCompanyId(companyId);
      await loadAppUser();
      window.location.reload();
    } catch (reason) {
      setActiveCompanyId(previous || null);
      setError(reason instanceof Error ? reason.message : String(reason));
      setSwitching(false);
    }
  };

  const context = useMemo(() => user ? { user, signOut, switchCompany } : null, [user]);

  if (loading) return <div className="auth-screen auth-screen--loading"><div className="auth-loading-card"><ImdsBrand compact/><LoaderCircle className="spin" size={25}/><p>Проверяем защищённую сессию</p></div></div>;
  if (user?.companies && user.companies.length > 1 && !user.companyId) return <CompanyPicker companies={user.companies} onSelect={(id) => void switchCompany(id)} busy={switching}/>;
  if (user && !user.companyId && (!user.companies || user.companies.length === 0)) return <PendingOrganization user={user} onSignOut={signOut}/>;

  if (!user || !context) return <div className="auth-screen">
    <div className="auth-orb auth-orb--one"/><div className="auth-orb auth-orb--two"/>
    <div className="auth-layout">
      <section className="auth-showcase">
        <div className="auth-brand"><ImdsBrand/></div>
        <div className="auth-copy">
          <div className="auth-eyebrow"><Sparkles size={14}/>IMDS MARKETING</div>
          <h1>Маркетинг, CRM и продажи — в одном контуре</h1>
          <p>Каждая организация получает отдельный tenant, сотрудников, права доступа, интеграции и собственные данные.</p>
        </div>
        <div className="auth-benefits">
          <div><CheckCircle2 size={17}/><span>Отдельный контур организации</span></div>
          <div><CheckCircle2 size={17}/><span>Роли и персональные права</span></div>
          <div><CheckCircle2 size={17}/><span>Email/пароль и Google</span></div>
        </div>
        <div className="auth-preview" aria-hidden="true">
          <header><span>Единое рабочее пространство</span><i>Secure</i></header>
          <div className="auth-preview-kpis">
            <div><small>Организация</small><b>Tenant</b><em>Изолировано</em></div>
            <div><small>Пользователи</small><b>Roles</b><em>Контроль</em></div>
            <div><small>Доступ</small><b>SSO</b><em>Google + пароль</em></div>
          </div>
          <div className="auth-preview-chart">{[38,52,45,70,49,64,58,82,68,88,76,94].map((height,index)=><i key={index} style={{height:`${height}%`}}/>)}</div>
        </div>
      </section>
      <LoginPanel onAuthenticated={setUser} error={error} setError={setError}/>
    </div>
  </div>;

  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}