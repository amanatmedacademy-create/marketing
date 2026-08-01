import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Building2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react';

type SessionUser = { id: string; name: string; email: string; role: string };
type SessionResponse = { user: SessionUser; companyId: string; role?: string };
type Mode = 'login' | 'register';

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Ошибка авторизации');
  return payload as T;
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
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function restore() {
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
      try { await authRequest<{ ok: true }>('logout', {}); } finally { setSession(null); }
    };
    window.addEventListener('imds:session-expired', expire);
    window.addEventListener('imds:logout-request', logout);
    return () => {
      window.removeEventListener('imds:session-expired', expire);
      window.removeEventListener('imds:logout-request', logout);
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = mode === 'register'
        ? await authRequest<SessionResponse>('register', { name, companyName, email, password })
        : await authRequest<SessionResponse>('login', { email, password });
      setSession(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выполнить вход');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) return <div className="auth-loading"><LoaderCircle size={28} className="auth-spinner" /><span>Проверка сессии…</span></div>;
  if (session) return <>{children}</>;

  return <main className="auth-page">
    <section className="auth-brand-panel">
      <div className="auth-logo"><span>IMDS</span><b>CRM</b></div>
      <div className="auth-brand-copy"><p className="auth-kicker">Омниканальная CRM для бизнеса</p><h1>Продажи, коммуникации и маркетинг в одной системе.</h1><p>Управляйте лидами, WhatsApp, Instagram, рекламой и задачами команды из единого рабочего пространства.</p></div>
      <div className="auth-benefits"><article><ShieldCheck size={20} /><div><strong>Изоляция компаний</strong><span>Каждая регистрация создаёт отдельное рабочее пространство.</span></div></article><article><ArrowRight size={20} /><div><strong>Быстрый запуск</strong><span>Стартовая воронка и готовые CRM-модули.</span></div></article></div>
    </section>
    <section className="auth-form-panel">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-mobile-logo">IMDS <b>CRM</b></div>
        <header><span>{mode === 'login' ? 'С возвращением' : 'Создание аккаунта'}</span><h2>{mode === 'login' ? 'Войти в систему' : 'Зарегистрироваться'}</h2><p>{mode === 'login' ? 'Введите данные вашей учётной записи.' : 'Создайте отдельное рабочее пространство компании.'}</p></header>
        <div className="auth-mode-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Вход</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Регистрация</button></div>
        {mode === 'register' && <><label className="auth-field"><span>Имя</span><div><UserRound size={17} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ваше имя" autoComplete="name" required /></div></label><label className="auth-field"><span>Компания</span><div><Building2 size={17} /><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Название компании" autoComplete="organization" required /></div></label></>}
        <label className="auth-field"><span>Email</span><div><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.kz" autoComplete="email" required /></div></label>
        <label className="auth-field"><span>Пароль</span><div><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Минимум 8 символов" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Показать пароль">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        {error && <div className="auth-error">{error}</div>}
        <button className="auth-submit" disabled={submitting}>{submitting ? <LoaderCircle size={18} className="auth-spinner" /> : <ArrowRight size={18} />}{mode === 'login' ? 'Войти' : 'Создать компанию'}</button>
        <p className="auth-legal">Продолжая, вы соглашаетесь с условиями использования и политикой конфиденциальности.</p>
      </form>
    </section>
  </main>;
}
