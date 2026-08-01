import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Building2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

type Mode = 'login' | 'register';
type Workspace = { user_id: string; company_id: string; role: string };

function readableAuthError(message: string) {
  const value = message.toLowerCase();
  if (value.includes('invalid login credentials')) return 'Неверный email или пароль.';
  if (value.includes('email not confirmed')) return 'Подтвердите email по ссылке из письма.';
  if (value.includes('user already registered')) return 'Пользователь с таким email уже зарегистрирован.';
  if (value.includes('provider is not enabled') || value.includes('unsupported provider')) return 'Вход через Google ещё не настроен в Supabase.';
  if (value.includes('company_required')) return 'Укажите название компании для завершения регистрации.';
  if (value.includes('rate limit')) return 'Слишком много попыток. Повторите позже.';
  return message || 'Ошибка авторизации.';
}

async function completeWorkspace(companyName?: string, fullName?: string) {
  const { data, error } = await supabase.rpc('complete_marketing_registration', {
    company_name: companyName?.trim() || null,
    full_name: fullName?.trim() || null,
  });
  if (error) throw error;
  const workspace = (Array.isArray(data) ? data[0] : data) as Workspace | null;
  if (!workspace?.company_id) throw new Error('Supabase не вернул рабочее пространство.');
  return workspace;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSession, setPendingSession] = useState<Session | null>(null);
  const [error, setError] = useState('');

  async function applySession(nextSession: Session | null) {
    setSession(nextSession);
    setWorkspace(null);
    if (!nextSession) return;

    const storedCompany = window.sessionStorage.getItem('imds_oauth_company') ?? '';
    try {
      const result = await completeWorkspace(storedCompany || undefined, nextSession.user.user_metadata?.full_name ?? nextSession.user.user_metadata?.name);
      window.sessionStorage.removeItem('imds_oauth_company');
      setWorkspace(result);
      setPendingSession(null);
      setError('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Не удалось загрузить рабочее пространство.';
      if (message.toLowerCase().includes('company_required')) {
        setPendingSession(nextSession);
        setMode('register');
        setError('Укажите название компании для завершения регистрации.');
      } else {
        setError(readableAuthError(message));
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!cancelled) await applySession(data.session);
    }).catch((reason) => {
      if (!cancelled) setError(readableAuthError(reason instanceof Error ? reason.message : 'Не удалось восстановить сессию.'));
    }).finally(() => {
      if (!cancelled) setChecking(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => {
        if (!cancelled) void applySession(nextSession);
      }, 0);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const expire = () => {
      setSession(null);
      setWorkspace(null);
    };
    const logout = async () => {
      setSubmitting(true);
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } finally {
        window.sessionStorage.removeItem('imds_oauth_company');
        setSession(null);
        setWorkspace(null);
        setPendingSession(null);
        setPassword('');
        setError('');
        setMode('login');
        setSubmitting(false);
      }
    };
    const delegateLogout = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (button?.textContent?.trim() === 'Выйти') {
        event.preventDefault();
        event.stopPropagation();
        void logout();
      }
    };
    window.addEventListener('imds:session-expired', expire);
    window.addEventListener('imds:logout-request', logout);
    document.addEventListener('click', delegateLogout, true);
    return () => {
      window.removeEventListener('imds:session-expired', expire);
      window.removeEventListener('imds:logout-request', logout);
      document.removeEventListener('click', delegateLogout, true);
    };
  }, []);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError('');
    setPassword('');
    setShowPassword(false);
    if (nextMode === 'login') {
      setName('');
      setCompanyName('');
      setPendingSession(null);
      window.sessionStorage.removeItem('imds_oauth_company');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (pendingSession) {
        const result = await completeWorkspace(companyName, pendingSession.user.user_metadata?.full_name ?? pendingSession.user.user_metadata?.name);
        setWorkspace(result);
        setPendingSession(null);
        return;
      }

      if (mode === 'register') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name.trim(), company_name: companyName.trim() },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setError('Проверьте email и подтвердите регистрацию, затем войдите в систему.');
          return;
        }
        setSession(data.session);
        setWorkspace(await completeWorkspace(companyName, name));
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      setSession(data.session);
      setWorkspace(await completeWorkspace());
    } catch (reason) {
      setError(readableAuthError(reason instanceof Error ? reason.message : 'Не удалось выполнить вход'));
    } finally {
      setSubmitting(false);
    }
  }

  async function startGoogle() {
    setError('');
    if (mode === 'register') {
      if (!companyName.trim()) {
        setError('Сначала укажите название компании.');
        return;
      }
      window.sessionStorage.setItem('imds_oauth_company', companyName.trim());
    } else {
      window.sessionStorage.removeItem('imds_oauth_company');
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (oauthError) setError(readableAuthError(oauthError.message));
  }

  if (checking) return <div className="auth-loading"><LoaderCircle size={28} className="auth-spinner" /><span>Проверка сессии…</span></div>;
  if (session && workspace) return <>{children}</>;

  return <main className="auth-page">
    <section className="auth-brand-panel">
      <div className="auth-logo"><span>IMDS</span><b>CRM</b></div>
      <div className="auth-brand-copy"><p className="auth-kicker">Омниканальная CRM для бизнеса</p><h1>Продажи, коммуникации и маркетинг в одной системе.</h1><p>Управляйте лидами, WhatsApp, Instagram, рекламой и задачами команды из единого рабочего пространства.</p></div>
      <div className="auth-benefits"><article><ShieldCheck size={20} /><div><strong>Supabase Auth</strong><span>Вход, регистрация и Google работают как в IMDS MIS.</span></div></article><article><ArrowRight size={20} /><div><strong>Изоляция компаний</strong><span>Каждая регистрация создаёт отдельное рабочее пространство.</span></div></article></div>
    </section>
    <section className="auth-form-panel">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-mobile-logo">IMDS <b>CRM</b></div>
        <header><span>{pendingSession ? 'Завершение регистрации' : mode === 'login' ? 'С возвращением' : 'Создание аккаунта'}</span><h2>{pendingSession ? 'Создайте компанию' : mode === 'login' ? 'Войти в систему' : 'Зарегистрироваться'}</h2><p>{pendingSession ? 'Аккаунт подтверждён. Осталось создать рабочее пространство.' : mode === 'login' ? 'Войдите через Supabase Auth.' : 'Создайте аккаунт и отдельное рабочее пространство.'}</p></header>

        {!pendingSession && <>
          <button type="button" className="auth-google" onClick={() => void startGoogle()} disabled={submitting}><span className="google-mark">G</span>{mode === 'login' ? 'Войти через Google' : 'Зарегистрироваться через Google'}</button>
          <div className="auth-divider"><span>или</span></div>
          <div className="auth-mode-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} disabled={submitting}>Вход</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')} disabled={submitting}>Регистрация</button></div>
        </>}

        {(mode === 'register' || pendingSession) && <>
          {!pendingSession && <label className="auth-field"><span>Имя</span><div><UserRound size={17} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ваше имя" autoComplete="name" required /></div></label>}
          <label className="auth-field"><span>Компания</span><div><Building2 size={17} /><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Название компании" autoComplete="organization" required /></div></label>
        </>}

        {!pendingSession && <>
          <label className="auth-field"><span>Email</span><div><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.kz" autoComplete="email" required /></div></label>
          <label className="auth-field"><span>Пароль</span><div><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Минимум 8 символов" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Показать пароль">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        </>}

        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="auth-submit" disabled={submitting}>{submitting ? <LoaderCircle size={18} className="auth-spinner" /> : <ArrowRight size={18} />}{pendingSession ? 'Создать компанию и войти' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
        <p className="auth-legal">Авторизация выполняется напрямую через Supabase Auth.</p>
      </form>
    </section>
  </main>;
}
