import { FormEvent, useEffect, useState } from 'react';
import { Building2, Loader2, LockKeyhole, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';

type AuthMode = 'login' | 'register';
type MeResponse = {
  user: { id: string; email: string; firstName?: string; lastName?: string; locale: string };
  company: { id: string; name: string; slug: string; timezone: string; locale: string; currency: string };
  role: 'OWNER' | 'ADMIN' | 'MANAGER';
};

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
let accessToken = '';

async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry && path !== '/auth/refresh') {
    const refresh = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refresh.ok) {
      const payload = await refresh.json() as { accessToken: string };
      accessToken = payload.accessToken;
      return api<T>(path, init, false);
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? 'Ошибка запроса');
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<MeResponse>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<{ accessToken: string }>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }, false);
      accessToken = result.accessToken;
      setMe(await api<MeResponse>('/auth/me'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка авторизации');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    accessToken = '';
    setMe(null);
  }

  if (loading) return <main className="auth-shell"><Loader2 className="spinner" /></main>;

  if (me) {
    return (
      <main className="auth-shell">
        <section className="session-card">
          <span className="eyebrow">IMDS CRM</span>
          <ShieldCheck size={42} />
          <h1>Доступ подтверждён</h1>
          <p>{me.user.firstName} {me.user.lastName}</p>
          <dl>
            <div><dt>Компания</dt><dd>{me.company.name}</dd></div>
            <div><dt>Роль</dt><dd>{me.role}</dd></div>
            <div><dt>Часовой пояс</dt><dd>{me.company.timezone}</dd></div>
            <div><dt>Валюта</dt><dd>{me.company.currency}</dd></div>
          </dl>
          <button className="secondary-button" onClick={logout}><LogOut size={17} /> Выйти</button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-copy">
          <span className="eyebrow">IMDS CRM</span>
          <h1>{mode === 'login' ? 'Вход в систему' : 'Создание компании'}</h1>
          <p>JWT access token, защищённая refresh-cookie, роли и мультитенантная изоляция.</p>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && <>
            <label><Building2 size={17} /><input name="companyName" placeholder="Название компании" required /></label>
            <label><Building2 size={17} /><input name="companySlug" placeholder="company-slug" pattern="[a-z0-9-]+" required /></label>
            <div className="form-row">
              <label><UserRound size={17} /><input name="firstName" placeholder="Имя" required /></label>
              <label><UserRound size={17} /><input name="lastName" placeholder="Фамилия" required /></label>
            </div>
          </>}
          <label><Mail size={17} /><input type="email" name="email" placeholder="Email" required /></label>
          <label><LockKeyhole size={17} /><input type="password" name="password" placeholder="Пароль" minLength={10} required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" disabled={submitting}>
            {submitting && <Loader2 size={17} className="spinner" />}
            {mode === 'login' ? 'Войти' : 'Создать компанию'}
          </button>
        </form>

        <button className="mode-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'Нет аккаунта? Создать компанию' : 'Уже есть аккаунт? Войти'}
        </button>
      </section>
    </main>
  );
}
