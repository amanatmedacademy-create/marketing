import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, LoaderCircle, RefreshCw, Save, Trash2 } from 'lucide-react';
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
type OAuthStart = { ok?: boolean; authorizationUrl?: string; redirectUri?: string };
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

function clearOAuthParams() {
  const url = new URL(window.location.href);
  ['code', 'state', 'error', 'error_description', 'error_message'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export default function CloudTelephonyIntegrationPanel({ provider, onChanged }: Props) {
  const isSipuni = provider === 'sipuni';
  const title = isSipuni ? 'Sipuni' : 'Binotel';
  const [config, setConfig] = useState<ConfigResponse>({});
  const [form, setForm] = useState<Record<string, string>>({ outboundMethod: 'GET' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const load = async () => {
    setBusy('load');
    try {
      const next = await request<ConfigResponse>(`/api/telephony/providers/${provider}`);
      setConfig(next);
      setForm((previous) => ({ outboundMethod: 'GET', ...previous, ...(next.provider?.values || {}) }));
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(''); }
  };

  useEffect(() => { void load(); }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isSipuni) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || '';
    const state = params.get('state') || '';
    const providerError = params.get('error_description') || params.get('error_message') || params.get('error') || '';
    if (!state.startsWith('binotel:')) return;
    if (providerError) {
      setMessage({ type: 'error', text: providerError });
      clearOAuthParams();
      return;
    }
    if (!code) return;
    setBusy('oauth-complete');
    void request<{ ok?: boolean; connected?: boolean }>('/api/telephony/providers/binotel/oauth/complete', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    }).then(async () => {
      clearOAuthParams();
      setMessage({ type: 'ok', text: 'Binotel подключён через OAuth.' });
      await load();
      onChanged?.();
    }).catch((error) => {
      clearOAuthParams();
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) });
    }).finally(() => setBusy(''));
  }, [isSipuni]); // eslint-disable-line react-hooks/exhaustive-deps

  const startOAuth = async () => {
    setBusy('oauth-start');
    setMessage(null);
    try {
      const next = await request<OAuthStart>('/api/telephony/providers/binotel/oauth/start', { method: 'POST', body: '{}' });
      if (!next.authorizationUrl) throw new Error('Сервер не вернул Binotel OAuth URL');
      window.location.assign(next.authorizationUrl);
    } catch (error) {
      setBusy('');
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  const saveSipuni = async () => {
    setBusy('save');
    setMessage(null);
    try {
      const payload = {
        userId: form.userId || '',
        apiKey: form.apiKey || '',
        outboundUrlTemplate: form.outboundUrlTemplate || '',
        outboundMethod: form.outboundMethod || 'GET',
        activate: true,
      };
      const next = await request<ConfigResponse>('/api/telephony/providers/sipuni', { method: 'PUT', body: JSON.stringify(payload) });
      setConfig(next);
      setForm((previous) => ({ ...previous, apiKey: '', outboundUrlTemplate: '' }));
      setMessage({ type: 'ok', text: 'Sipuni: настройки сохранены и провайдер выбран для текущего филиала.' });
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
      setConfig({});
      setForm({ outboundMethod: 'GET' });
      setMessage({ type: 'ok', text: `${title} отключён.` });
      onChanged?.();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(''); }
  };

  const copyWebhook = async () => {
    if (!config.webhookUrl) return;
    await navigator.clipboard.writeText(config.webhookUrl);
    setMessage({ type: 'ok', text: 'Webhook URL скопирован.' });
  };

  const configured = Boolean(config.provider?.configured);
  const connected = config.provider?.status === 'connected' && !config.provider?.lastError;
  const savedApiKey = Boolean(config.provider?.secretFields?.apiKey);
  const savedOutbound = Boolean(config.provider?.secretFields?.outboundUrlTemplate);

  return <section className="zadarma-integration" aria-label={`Настройка ${title}`}>
    <header className="zadarma-integration__head">
      <div className="zadarma-integration__brand">
        <span>{connected ? <CheckCircle2 size={22}/> : <RefreshCw size={22}/>}</span>
        <div>
          <small>CLOUD TELEPHONY</small>
          <h2>{title}</h2>
          <p>{isSipuni ? 'Виртуальная АТС: события звонков, записи, пропущенные и CRM-аналитика.' : 'Телефония, записи, пропущенные звонки и CRM-аналитика через Binotel.'}</p>
        </div>
      </div>
      <button type="button" onClick={() => void load()} disabled={Boolean(busy)}>
        {busy === 'load' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить
      </button>
    </header>

    {message && <div className={`zadarma-integration__message ${message.type === 'error' ? 'is-error' : 'is-success'}`}>{message.text}</div>}
    {config.provider?.lastError && <div className="zadarma-integration__message is-error">{config.provider.lastError}</div>}

    <div className="zadarma-integration__grid">
      <div className="zadarma-integration__form">
        {!isSipuni ? <>
          <div className="zadarma-integration__automation">
            <div>
              <span>Подключение Binotel</span>
              <p>{connected ? 'Binotel подключён к текущему филиалу.' : 'Авторизуйтесь в Binotel и подтвердите доступ для текущего филиала.'}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void startOAuth()} disabled={Boolean(busy)}>
              {busy === 'oauth-start' || busy === 'oauth-complete' ? <LoaderCircle className="spin" size={16}/> : <ExternalLink size={16}/>} {connected ? 'Переподключить Binotel' : 'Подключить через OAuth'}
            </button>
            {configured && <button type="button" onClick={() => void disconnect()} disabled={Boolean(busy)}><Trash2 size={16}/> Отключить</button>}
          </div>
        </> : <>
          <label><span>User ID *</span><input value={form.userId || ''} onChange={(event) => setForm((value) => ({ ...value, userId: event.target.value }))} placeholder="ID пользователя Sipuni"/></label>
          <label><span>API key *</span><input type="password" value={form.apiKey || ''} onChange={(event) => setForm((value) => ({ ...value, apiKey: event.target.value }))} placeholder={savedApiKey ? 'Ключ уже сохранён. Оставьте пустым, чтобы не менять.' : 'API key'}/></label>
          <label><span>URL исходящего вызова</span><input type="password" value={form.outboundUrlTemplate || ''} onChange={(event) => setForm((value) => ({ ...value, outboundUrlTemplate: event.target.value }))} placeholder={savedOutbound ? 'Callback URL уже сохранён. Оставьте пустым, чтобы не менять.' : 'https://provider.example/call?phone={phone}&user={userId}&key={apiKey}'}/></label>
          <label><span>Метод исходящего вызова</span><select value={form.outboundMethod || 'GET'} onChange={(event) => setForm((value) => ({ ...value, outboundMethod: event.target.value }))}><option value="GET">GET</option><option value="POST">POST</option></select></label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void saveSipuni()} disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Сохранить и активировать</button>
            {configured && <button type="button" onClick={() => void disconnect()} disabled={Boolean(busy)}><Trash2 size={16}/> Отключить</button>}
          </div>
        </>}

        <div className="zadarma-integration__automation">
          <div><span>Статус</span><p>{connected ? 'Подключено' : configured ? 'Настройки сохранены · ожидаем события' : 'Не подключено'}</p></div>
        </div>

        {config.webhookUrl && <div className="zadarma-integration__automation">
          <div><span>Webhook URL</span><p style={{ wordBreak: 'break-all' }}>{config.webhookUrl}</p></div>
          <button type="button" onClick={() => void copyWebhook()}><Copy size={15}/> Копировать</button>
        </div>}

        <div className="zadarma-integration__automation">
          <div><span>Что включается</span><p>Входящие/исходящие события · история звонков · пропущенные · записи · транскрипция · AI Call Intelligence · CRM-связка.</p></div>
        </div>
      </div>
    </div>
  </section>;
}
