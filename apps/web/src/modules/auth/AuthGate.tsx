import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Building2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

type SessionUser = { id: string; name: string; email: string; role: string };
type SessionResponse = { user: SessionUser; companyId: string; role?: string };
type Mode = 'login' | 'register';

type ApiError = Error & { code?: string };

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? 'Ошибка авторизации') as ApiError;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload as T;
}

async function createCrmSession(session: Session, companyName?: string, provider: 'email' | 'google' = 'email') {
  return authRequest<SessionResponse>('supabase/session', {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    companyName: companyName?.trim() || undefined,
    provider,
  });
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSupabaseSession, setPendingSupabaseSession] = useState<Session | null>(null);
  const [pendingProvider, setPendingProvider] = useState<'email' | 'google'>('email');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function finishSupabaseSession(supabaseSession: Session, provider: 'email' | 'google') {
      const storedCompanyName = window.sessionStorage.getItem('imds_oauth_company') ?? '';
      try {
        const current = await createCrmSession(supabaseSession, storedCompanyName, provider);
        window.sessionStorage.removeItem('imds_oauth_company');
        if (!cancelled) setSession(current);
      } catch (reason) {
        const sessionError = reason as ApiError;
        if (sessionError.code === 'COMPANY_REQUIRED') {
          if (!cancelled) {
            setPendingSupabaseSession(supabaseSession);
            setPendingProvider(provider);
            setMode('register');
            setError('Укажите название компании для завершения регистрации.');
          }
        } else if (!cancelled) {
          setError(sessionError.message);
        }
      }
    }

    async function restore() {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          const provider = data.session.user.app_metadata.provider === 'google' ? 'google' : 'email';
          await finishSupabaseSession(data.session, provider);
          return;
        }

        try {
          const current = await authRequest<SessionResponse>('me');
          if (!cancelled) setSession(current);
        } catch {
          try {
            const refreshed = await authRequest<SessionResponse>('refresh', {});
            if (!cancelled) setSession(refreshed);
          } catch {
            if (!cancelled) setSession(null);
          }
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void restore();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const expire = () => setSession(null);
    const logout = async () => {
      try {
        await Promise.allSettled([
          authRequest<{ ok: true }>('logout', {}),
          supabase.auth.signOut(),
        ]);
      } finally {
        setSession(null);
        setPendingSupabaseSession(null);
      }
    };
    const delegateLogout = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (button?.textContent?.trim() === 'Выйти') {
        event.preventDefault();
        void logout();
      }
    };
    window.addEventListener('imds:session-expired', expire);
    window.addEventListener('imds:logout-request', logout);
    document.addEventListener('click', delegateLogout);
    return () => {
      window.removeEventListener('imds:session-expired', expire);
      window.removeEventListener('imds:logout-request', logout);
      document.removeEventListener('click', delegateLogout);
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (pendingSupabaseSession) {
        const result = await createCrmSession(pendingSupabaseSession, companyName, pendingProvider);
        setPendingSupabaseSession(null);
        setSession(result);
        return;
      }

      if (mode === 'register') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: { name: name.trim(), company_name: companyName.trim() },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setError('Проверьте email и подтвердите регистрацию, затем войдите в систему.');
          return;
        }
        setSession(await createCrmSession(data.session, companyName, 'email'));
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      setSession(await createCrmSession(data.session, undefined, 'email'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выполнить вход');
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
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });
    if (oauthError) setError(oauthError.message);
  }

  if (checking) return <div className="auth-loading"><LoaderCircle size={28} className="auth-spinner" /><span>Проверка сессии…</span></div>;
  if (session) return <>{children}</>;

  return <main className="auth-page">
    <section className="auth-brand-panel">
      <div className="auth-logo"><span>IMDS</span><b>CRM</b></div>
      <div className="auth-brand-copy"><p className="auth-kicker">Омниканальная CRM для бизнеса</p><h1>Продажи, коммуникации и маркетинг в одной системе.</h1><p>Управляйте лидами, WhatsApp, Instagram, рекламой и задачами команды из единого рабочего пространства.</p></div>
      <div className="auth-benefits"><article><ShieldCheck size={20} /><div><strong>Supabase Auth</strong><span>Email, пароль и Google работают через единый сервис авторизации.</span></div></article><article><ArrowRight size={20} /><div><strong>Изоляция компаний</strong><span>Каждая регистрация создаёт отдельное рабочее пространство.</span></div></article></div>
    </section>
    <section className="auth-form-panel">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-mobile-logo">IMDS <b>CRM</b></div>
        <header><span>{pendingSupabaseSession ? 'Завершение регистрации' : mode === 'login' ? 'С возвращением' : 'Создание аккаунта'}</span><h2>{pendingSupabaseSession ? 'Создайте компанию' : mode === 'login' ? 'Войти в систему' : 'Зарегистрироваться'}</h2><p>{pendingSupabaseSession ? 'Аккаунт подтверждён через Supabase. Осталось создать рабочее пространство.' : mode === 'login' ? 'Войдите через Supabase Auth.' : 'Создайте аккаунт и отдельное рабочее пространство.'}</p></header>

        {!pendingSupabaseSession && <>
          <button type="button" className="auth-google" onClick={() => void startGoogle()}><span className="google-mark">G</span>{mode === 'login' ? 'Войти через Google' : 'Зарегистрироваться через Google'}</button>
          <div className="auth-divider"><span>или</span></div>
          <div className="auth-mode-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Вход</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Регистрация</button></div>
        </>}

        {(mode === 'register' || pendingSupabaseSession) && <>
          {!pendingSupabaseSession && <label className="auth-field"><span>Имя</span><div><UserRound size={17} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ваше имя" autoComplete="name" required /></div></label>}
          <label className="auth-field"><span>Компания</span><div><Building2 size={17} /><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Название компании" autoComplete="organization" required /></div></label>
        </>}

        {!pendingSupabaseSession && <>
          <label className="auth-field"><span>Email</span><div><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.kz" autoComplete="email" required /></div></label>
          <label className="auth-field"><span>Пароль</span><div><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Минимум 8 символов" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Показать пароль">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        </>}

        {error && <div className="auth-error">{error}</div>}
        <button className="auth-submit" disabled={submitting}>{submitting ? <LoaderCircle size={18} className="auth-spinner" /> : <ArrowRight size={18} />}{pendingSupabaseSession ? 'Создать компанию и войти' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
        <p className="auth-legal">Авторизация выполняется через Supabase Auth.</p>
      </form>
    </section>
  </main>;
}
