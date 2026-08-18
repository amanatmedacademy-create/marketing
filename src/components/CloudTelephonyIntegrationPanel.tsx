import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, LoaderCircle, RefreshCw, Save, Trash2 } from 'lucide-react';
import { authFetch } from '../services/auth';

type Provider = 'binotel' | 'sipuni';
type ProviderSummary = {
  provider?: string;
  configured?: boolean;
  status?: string;
  values?: Record<string, string>;
  secretFields?: Record<string, boolean>;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};
type ConfigResponse = { provider?: ProviderSummary; webhookUrl?: string | null };

type Props = { provider: Provider; onChanged?: () => void };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body) headers.set('content-type', 'application/json');
  const response = await authFetch(path, { ...init, headers, cache: 'no-store' });
  const raw = await response.text();
  let payload: unknown = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || raw || `HTTP ${response.status}`);
  return payload as T;
}

export default function CloudTelephonyIntegrationPanel({ provider, onChanged }: Props) {
  const isSipuni = provider === 'sipuni';
  const title = isSipuni ? 'Sipuni' : 'Binotel';
  const [config, setConfig] = useState<ConfigResponse>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const load = async () => {
    setBusy('load');
    try {
      const next = await request<ConfigResponse>(`/api/telephony/providers/${provider}`);
      setConfig(next);
      setForm((previous) => ({ ...previous, ...(next.provider?.values || {}) }));
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(''); }
  };

  useEffect(() => { void load(); }, [provider]);

  const save = async () => {
    setBusy('save'); setMessage(null);
    try {
      const payload = isSipuni
        ? { userId: form.userId || '', apiKey: form.apiKey || '', activate: true }
        : { apiKey: form.apiKey || '', apiSecret: form.apiSecret || '', apiBaseUrl: form.apiBaseUrl || '', activate: true };
      const next = await request<ConfigResponse>(`/api/telephony/providers/${provider}`, { method: 'PUT', body: JSON.stringify(payload) });
      setConfig(next);
      setForm((previous) => ({ ...previous, apiKey: '', ...(isSipuni ? {} : { apiSecret: '' }) }));
      setMessage({ type: 'ok', text: `${title}: настройки сохранены. Теперь укажите webhook URL в кабинете провайдера.` });
      onChanged?.();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(''); }
  };

  const disconnect = async () => {
    if (!window.confirm(`Отключить ${title}?`)) return;
    setBusy('delete');
    try {
      await request(`/api/telephony/providers/${provider}`, { method: 'DELETE' });
      setConfig({}); setForm({}); setMessage({ type: 'ok', text: `${title} отключён.` }); onChanged?.();
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  };

  const copyWebhook = async () => {
    if (!config.webhookUrl) return;
    await navigator.clipboard.writeText(config.webhookUrl);
    setMessage({ type: 'ok', text: 'Webhook URL скопирован.' });
  };

  const configured = Boolean(config.provider?.configured);
  const connected = config.provider?.status === 'connected' && !config.provider?.lastError;
  const savedApiKey = Boolean(config.provider?.secretFields?.apiKey);
  const savedApiSecret = Boolean(config.provider?.secretFields?.apiSecret);

  return <section className="zadarma-integration" aria-label={`Настройка ${title}`}>
    <header className="zadarma-integration__head">
      <div className="zadarma-integration__brand">
        <span>{connected ? <CheckCircle2 size={22}/> : <RefreshCw size={22}/>}</span>
        <div><small>CLOUD TELEPHONY</small><h2>{title}</h2><p>{isSipuni ? 'Виртуальная АТС: события звонков, записи, пропущенные и CRM-аналитика.' : 'Облачная телефония: события звонков, записи, пропущенные и CRM-аналитика.'}</p></div>
      </div>
      <button type="button" onClick={() => void load()} disabled={Boolean(busy)}>{busy === 'load' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить</button>
    </header>

    {message && <div className={`zadarma-integration__message ${message.type === 'error' ? 'is-error' : 'is-success'}`}>{message.text}</div>}
    {config.provider?.lastError && <div className="zadarma-integration__message is-error">{config.provider.lastError}</div>}

    <div className="zadarma-integration__grid">
      <div className="zadarma-integration__form">
        {isSipuni && <label><span>User ID *</span><input value={form.userId || ''} onChange={(event) => setForm((value) => ({ ...value, userId: event.target.value }))} placeholder="ID пользователя Sipuni"/></label>}
        <label><span>{isSipuni ? 'API key *' : 'API key *'}</span><input type="password" value={form.apiKey || ''} onChange={(event) => setForm((value) => ({ ...value, apiKey: event.target.value }))} placeholder={savedApiKey ? 'Ключ уже сохранён. Оставьте пустым, чтобы не менять.' : 'API key'}/></label>
        {!isSipuni && <>
          <label><span>API secret *</span><input type="password" value={form.apiSecret || ''} onChange={(event) => setForm((value) => ({ ...value, apiSecret: event.target.value }))} placeholder={savedApiSecret ? 'Secret уже сохранён. Оставьте пустым, чтобы не менять.' : 'API secret'}/></label>
          <label><span>API base URL</span><input value={form.apiBaseUrl || ''} onChange={(event) => setForm((value) => ({ ...value, apiBaseUrl: event.target.value }))} placeholder="Необязательно; укажите только если Binotel выдал отдельный endpoint"/></label>
        </>}

        <div className="zadarma-integration__automation"><div><span>Статус</span><p>{connected ? 'Webhook получает реальные события' : configured ? 'Credentials сохранены · ожидаем первое событие webhook' : 'Не подключено'}</p></div></div>

        {config.webhookUrl && <div className="zadarma-integration__automation"><div><span>Webhook URL</span><p style={{ wordBreak: 'break-all' }}>{config.webhookUrl}</p></div><button type="button" onClick={() => void copyWebhook()}><Copy size={15}/> Копировать</button></div>}

        <div className="zadarma-integration__automation"><div><span>Что включается</span><p>Входящие/исходящие события · история звонков · пропущенные · записи · транскрипция · AI Call Intelligence · CRM-связка.</p></div></div>
        <div className="zadarma-integration__automation"><div><span>Настройка у провайдера</span><p>{isSipuni ? 'В Sipuni откройте настройки API → события на АТС и вставьте Webhook URL.' : 'В Binotel добавьте Webhook URL в API/WebHook настройках вашего кабинета. REST click-to-call подключим после получения точного endpoint вашего аккаунта.'}</p></div></div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void save()} disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Сохранить и активировать</button>
          {configured && <button type="button" onClick={() => void disconnect()} disabled={Boolean(busy)}><Trash2 size={16}/> Отключить</button>}
        </div>
      </div>
    </div>
  </section>;
}
