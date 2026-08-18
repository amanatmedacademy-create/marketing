import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, LoaderCircle, MailCheck, RefreshCw, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-react';
import {
  disableAccountMfa,
  enableAccountMfa,
  loadAccountSecurity,
  sendAccountEmailVerification,
  startAccountMfaSetup,
  type AccountSecurityState,
  type MfaSetup,
} from '../services/account';

const eventLabels: Record<string, string> = {
  'auth.login': 'Вход в аккаунт',
  'auth.password_failed': 'Неудачный пароль',
  'mfa.challenge_created': 'Запрошен MFA',
  'mfa.challenge_completed': 'MFA подтверждён',
  'mfa.challenge_failed': 'Ошибка MFA',
  'mfa.setup_started': 'Начата настройка MFA',
  'mfa.enabled': 'MFA включён',
  'mfa.disabled': 'MFA выключен',
  'email.verification_sent': 'Отправлено подтверждение email',
  'email.verified': 'Email подтверждён',
};
const formatDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function AccountSecurityPanel() {
  const [state, setState] = useState<AccountSecurityState | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setBusy('load'); setError('');
    try { setState(await loadAccountSecurity()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };
  useEffect(() => { void load(); }, []);

  const action = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(''); setNotice('');
    try { await fn(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  if (!state && busy === 'load') return <div className="users-loading"><LoaderCircle className="spin"/>Загрузка безопасности…</div>;
  if (!state) return <div className="workspace-message workspace-message--error">{error || 'Не удалось загрузить настройки безопасности'}</div>;

  return <div className="account-security-panel">
    {error && <div className="workspace-message workspace-message--error"><TriangleAlert size={15}/>{error}</div>}
    {notice && <div className="workspace-message workspace-message--notice">{notice}</div>}

    <div className="workspace-card">
      <div className="workspace-card-head"><h4>Email</h4><span>{state.emailVerified ? 'Подтверждён' : 'Требует подтверждения'}</span></div>
      <div className="security-status-row">
        <span className={state.emailVerified ? 'security-state-ok' : 'security-state-warning'}>{state.emailVerified ? <CheckCircle2 size={18}/> : <MailCheck size={18}/>}</span>
        <div><strong>{state.email}</strong><small>{state.emailVerified ? 'Email подтверждён для IMDS Account.' : state.emailDeliveryConfigured ? 'Отправьте одноразовую ссылку подтверждения.' : 'Доставка писем ещё не подключена администратором платформы.'}</small></div>
        {!state.emailVerified && <button type="button" disabled={Boolean(busy) || !state.emailDeliveryConfigured} onClick={() => void action('email', async () => { await sendAccountEmailVerification(); setNotice('Письмо подтверждения отправлено.'); })}>{busy === 'email' ? 'Отправка…' : 'Подтвердить email'}</button>}
      </div>
    </div>

    <div className="workspace-card">
      <div className="workspace-card-head"><h4>Двухфакторная аутентификация</h4><span>{state.mfaEnabled ? 'Включена' : 'Выключена'}</span></div>
      {!state.mfaEnabled && !setup && <div className="security-status-row"><span className="security-state-warning"><ShieldOff size={18}/></span><div><strong>TOTP MFA</strong><small>Защитите вход кодом из Google Authenticator, Microsoft Authenticator, 1Password или другого TOTP-приложения.</small></div><button type="button" disabled={Boolean(busy)} onClick={() => void action('setup', async () => { setSetup(await startAccountMfaSetup()); })}><ShieldCheck size={15}/>Настроить</button></div>}
      {!state.mfaEnabled && setup && <div className="mfa-setup-box">
        <p>Добавьте ключ в authenticator-приложение и введите текущий 6-значный код.</p>
        <div className="mfa-secret"><code>{setup.secret}</code><button type="button" title="Копировать" onClick={() => void navigator.clipboard.writeText(setup.secret)}><Copy size={14}/></button></div>
        <small>URI: <code>{setup.otpauthUri}</code></small>
        <div className="password-grid"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}/><button className="workspace-primary" type="button" disabled={busy === 'enable' || code.length !== 6} onClick={() => void action('enable', async () => { const codes = await enableAccountMfa(code); setRecoveryCodes(codes); setSetup(null); setCode(''); setState(await loadAccountSecurity()); setNotice('MFA включён. Сохраните recovery codes в безопасном месте.'); })}><KeyRound size={15}/>Включить MFA</button></div>
      </div>}
      {state.mfaEnabled && <div className="security-status-row"><span className="security-state-ok"><ShieldCheck size={18}/></span><div><strong>TOTP MFA включён</strong><small>Осталось recovery codes: {state.recoveryCodesRemaining}. При следующем входе после пароля или Google потребуется второй фактор.</small></div><div className="security-disable"><input inputMode="numeric" maxLength={6} placeholder="Код TOTP" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}/><button type="button" disabled={busy === 'disable' || code.length !== 6} onClick={() => void action('disable', async () => { await disableAccountMfa(code); setCode(''); setState(await loadAccountSecurity()); setNotice('MFA выключен.'); })}>Выключить</button></div></div>}
      {recoveryCodes.length > 0 && <div className="recovery-codes"><strong>Recovery codes — показываются один раз</strong><div>{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div><button type="button" onClick={() => void navigator.clipboard.writeText(recoveryCodes.join('\n'))}><Copy size={14}/>Копировать все</button></div>}
    </div>

    <div className="workspace-card">
      <div className="workspace-card-head"><h4>Последние события безопасности</h4><button type="button" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={14}/>Обновить</button></div>
      <div className="security-event-list">{state.events.slice(0, 8).map((event) => <div key={event.id}><span className={event.result === 'failed' ? 'security-event-failed' : ''}>{eventLabels[event.type] || event.type}</span><small>{formatDate(event.createdAt)}{event.userAgent ? ` · ${event.userAgent}` : ''}</small></div>)}{!state.events.length && <span className="workspace-note">Событий безопасности пока нет.</span>}</div>
    </div>
  </div>;
}
