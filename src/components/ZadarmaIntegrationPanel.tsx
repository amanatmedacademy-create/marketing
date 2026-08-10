import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, LoaderCircle, PhoneCall, RefreshCw, ShieldCheck, Unplug, Webhook } from 'lucide-react';
import { useAuth } from './AuthGate';
import '../zadarma-integration.css';

type ProviderConfig = {
  provider: string;
  configured?: boolean;
  status?: string;
  values?: Record<string, string>;
  secretFields?: Record<string, boolean>;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};

type ConfigResponse = { providers?: ProviderConfig[] };
type TelephonyStatus = {
  provider?: string;
  configured?: boolean;
  extension?: string | null;
  credentialScope?: 'clinic' | 'default-clinic-fallback' | 'unconfigured' | string;
  capabilities?: string[];
};
type TelephonySettings = {
  auto_transcribe: boolean;
  auto_analyze: boolean;
  recording_delay_seconds: number;
  max_attempts: number;
  retry_after_minutes: number;
};
type SettingsResponse = { settings: TelephonySettings };
type WebhookHealth = {
  healthy: boolean;
  expectedUrl: string;
  configuredUrl?: string;
  checkedAt?: string;
  notifications?: Record<string, string>;
  local?: {
    callback?: { status?: string; requested_at?: string; matched_at?: string; completed_at?: string; pbx_call_id?: string; last_error?: string } | null;
    call?: { id?: string; call_status?: string; pbx_call_id?: string; recording_external_id?: string; transcription_status?: string; started_at?: string; updated_at?: string } | null;
  };
};

const asError = (error: unknown) => error instanceof Error ? error.message : String(error);
const defaultSettings: TelephonySettings = { auto_transcribe: false, auto_analyze: false, recording_delay_seconds: 45, max_attempts: 3, retry_after_minutes: 15 };
const defaultTelephonyStatus: TelephonyStatus = { configured: false, credentialScope: 'unconfigured' };
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const raw = await response.text();
  let payload: unknown = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload as T;
}

export default function ZadarmaIntegrationPanel() {
  const { user } = useAuth();
  const companyId = user.companyId || user.companies?.[0]?.id || '';
  const isAdmin = user.role === 'administrator';
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [status, setStatus] = useState<TelephonyStatus | null>(null);
  const [settings, setSettings] = useState<TelephonySettings>(defaultSettings);
  const [webhookHealth, setWebhookHealth] = useState<WebhookHealth | null>(null);
  const [form, setForm] = useState({ apiKey: '', apiSecret: '', pbxExtension: '' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const webhookUrl = useMemo(
    () => companyId ? `${window.location.origin}/api/telephony/zadarma/webhook/${companyId}` : '',
    [companyId],
  );

  const load = async () => {
    setBusy('load');
    try {
      const [configs, telephony, settingsResponse, webhook] = await Promise.all([
        jsonRequest<ConfigResponse>('/api/integrations/config'),
        jsonRequest<TelephonyStatus>('/api/telephony/status').catch(() => defaultTelephonyStatus),
        jsonRequest<SettingsResponse>('/api/telephony/settings').catch(() => ({ settings: defaultSettings })),
        jsonRequest<WebhookHealth>('/api/integrations/zadarma/webhook-status').catch(() => null),
      ]);
      const current = (configs.providers || []).find((item) => item.provider === 'zadarma') || null;
      setConfig(current);
      setStatus(telephony);
      setSettings(settingsResponse.settings || defaultSettings);
      setWebhookHealth(webhook);
      setForm((previous) => ({
        ...previous,
        pbxExtension: current?.values?.pbxExtension || telephony.extension || previous.pbxExtension,
      }));
    } catch (error) {
      setMessage({ type: 'error', text: asError(error) });
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { void load(); }, [companyId]);

  const save = async () => {
    const hasApiKey = Boolean(form.apiKey.trim() || config?.secretFields?.apiKey);
    const hasApiSecret = Boolean(form.apiSecret.trim() || config?.secretFields?.apiSecret);
    if (!hasApiKey || !hasApiSecret || !form.pbxExtension.trim()) {
      setMessage({ type: 'error', text: 'Заполните API key, API secret и внутренний номер АТС.' });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      await jsonRequest('/api/integrations/config/zadarma', {
        method: 'PUT',
        body: JSON.stringify({
          apiKey: form.apiKey.trim(),
          apiSecret: form.apiSecret.trim(),
          pbxExtension: form.pbxExtension.trim(),
        }),
      });
      await jsonRequest('/api/integrations/test/zadarma', { method: 'POST', body: '{}' });
      setForm((previous) => ({ ...previous, apiKey: '', apiSecret: '' }));
      setMessage({ type: 'ok', text: 'Zadarma подключена к выбранной клинике и API успешно проверен.' });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: asError(error) });
    } finally {
      setBusy('');
    }
  };

  const setupWebhook = async () => {
    if (!isAdmin) return;
    setBusy('webhook');
    setMessage(null);
    try {
      const health = await jsonRequest<WebhookHealth>('/api/integrations/zadarma/webhook-setup', { method: 'POST', body: '{}' });
      setWebhookHealth(health);
      setMessage({ type: 'ok', text: 'Webhook Zadarma настроен и повторно проверен через API.' });
    } catch (error) {
      setMessage({ type: 'error', text: asError(error) });
    } finally {
      setBusy('');
    }
  };

  const checkWebhook = async () => {
    setBusy('webhook-check');
    setMessage(null);
    try {
      const health = await jsonRequest<WebhookHealth>('/api/integrations/zadarma/webhook-status');
      setWebhookHealth(health);
      if (!health.healthy) setMessage({ type: 'error', text: 'Webhook Zadarma не полностью настроен. Нажмите «Настроить автоматически».' });
    } catch (error) {
      setWebhookHealth(null);
      setMessage({ type: 'error', text: asError(error) });
    } finally {
      setBusy('');
    }
  };

  const saveProcessing = async () => {
    if (!isAdmin) return;
    setBusy('settings');
    setMessage(null);
    try {
      const result = await jsonRequest<SettingsResponse>('/api/telephony/settings', {
        method: 'PUT',
        body: JSON.stringify({
          autoTranscribe: settings.auto_transcribe,
          autoAnalyze: settings.auto_analyze,
          recordingDelaySeconds: settings.recording_delay_seconds,
          maxAttempts: settings.max_attempts,
          retryAfterMinutes: settings.retry_after_minutes,
        }),
      });
      setSettings(result.settings);
      setMessage({ type: 'ok', text: settings.auto_transcribe ? 'Автообработка звонков включена для выбранной клиники.' : 'Автообработка звонков выключена для выбранной клиники.' });
    } catch (error) {
      setMessage({ type: 'error', text: asError(error) });
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить Zadarma только для выбранной клиники?')) return;
    setBusy('disconnect');
    setMessage(null);
    try {
      await jsonRequest('/api/integrations/config/zadarma', { method: 'DELETE' });
      setConfig(null);
      setStatus({ configured: false, credentialScope: 'unconfigured' });
      setWebhookHealth(null);
      setForm({ apiKey: '', apiSecret: '', pbxExtension: '' });
      setMessage({ type: 'ok', text: 'Zadarma отключена для выбранной клиники.' });
    } catch (error) {
      setMessage({ type: 'error', text: asError(error) });
    } finally {
      setBusy('');
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage({ type: 'error', text: 'Не удалось скопировать webhook URL.' });
    }
  };

  const connected = Boolean(config?.status === 'connected' && !config.lastError && status?.configured);
  const scopeLabel = status?.credentialScope === 'clinic'
    ? 'Отдельные credentials клиники'
    : status?.credentialScope === 'default-clinic-fallback'
      ? 'Legacy credentials основной клиники'
      : 'Credentials не настроены';
  const callback = webhookHealth?.local?.callback;
  const lastCall = webhookHealth?.local?.call;

  return <section className="zadarma-integration">
    <header className="zadarma-integration__head">
      <div className="zadarma-integration__brand"><span><PhoneCall size={22}/></span><div><small>TELEPHONY</small><h2>Zadarma</h2><p>Исходящие звонки, записи разговоров и AI Call Intelligence в контексте выбранной клиники.</p></div></div>
      <div className={`zadarma-integration__status ${connected ? 'is-connected' : ''}`}>
        {connected ? <CheckCircle2 size={16}/> : <ShieldCheck size={16}/>} {connected ? 'Подключено' : 'Не подключено'}
      </div>
    </header>

    {message && <div className={`zadarma-integration__message is-${message.type}`}>{message.text}</div>}

    <div className="zadarma-integration__grid">
      <div className="zadarma-integration__form">
        <label><span>API key *</span><input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={config?.secretFields?.apiKey ? 'Сохранён. Оставьте пустым, чтобы не менять.' : 'Zadarma API key'} /></label>
        <label><span>API secret *</span><input type="password" value={form.apiSecret} onChange={(event) => setForm({ ...form, apiSecret: event.target.value })} placeholder={config?.secretFields?.apiSecret ? 'Сохранён. Оставьте пустым, чтобы не менять.' : 'Zadarma API secret'} /></label>
        <label><span>Внутренний номер АТС *</span><input value={form.pbxExtension} onChange={(event) => setForm({ ...form, pbxExtension: event.target.value })} placeholder="Например 100" /></label>
        <div className="zadarma-integration__actions">
          <button type="button" className="zadarma-integration__primary" onClick={() => void save()} disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Сохранить и проверить</button>
          <button type="button" onClick={() => void load()} disabled={Boolean(busy)}>{busy === 'load' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Проверить статус</button>
          {config && <button type="button" className="zadarma-integration__danger" onClick={() => void disconnect()} disabled={Boolean(busy)}><Unplug size={16}/> Отключить</button>}
        </div>

        <div className="zadarma-integration__automation zadarma-integration__webhook">
          <div><span>Webhook Zadarma</span><p>IMDS сам установит URL выбранной клиники и включит NOTIFY_OUT_START / NOTIFY_OUT_END, затем повторно проверит настройки через Zadarma API.</p></div>
          <div className="zadarma-integration__webhook-state"><Webhook size={18}/><div><strong>{webhookHealth?.healthy ? 'Webhook готов' : connected ? 'Требуется проверка' : 'Сначала подключите API'}</strong><small>{webhookHealth?.checkedAt ? `Проверено ${dateTime(webhookHealth.checkedAt)}` : 'Проверка ещё не выполнялась'}</small></div></div>
          <div className="zadarma-integration__actions">
            {isAdmin && <button type="button" className="zadarma-integration__primary" onClick={() => void setupWebhook()} disabled={!connected || Boolean(busy)}>{busy === 'webhook' ? <LoaderCircle className="spin" size={16}/> : <Webhook size={16}/>} Настроить автоматически</button>}
            <button type="button" onClick={() => void checkWebhook()} disabled={!connected || Boolean(busy)}>{busy === 'webhook-check' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Проверить webhook</button>
          </div>
        </div>

        <div className="zadarma-integration__automation">
          <div><span>Автообработка записей</span><p>Выключено по умолчанию. Включайте только для клиники, где автоматическая отправка аудио на транскрипцию разрешена.</p></div>
          <label className="zadarma-switch"><input type="checkbox" checked={settings.auto_transcribe} disabled={!isAdmin || Boolean(busy)} onChange={(event) => setSettings({ ...settings, auto_transcribe: event.target.checked, auto_analyze: event.target.checked ? settings.auto_analyze : false })}/><span>Автотранскрипция</span></label>
          <label className="zadarma-switch"><input type="checkbox" checked={settings.auto_analyze} disabled={!isAdmin || !settings.auto_transcribe || Boolean(busy)} onChange={(event) => setSettings({ ...settings, auto_analyze: event.target.checked })}/><span>Авто AI-анализ после транскрипции</span></label>
          <div className="zadarma-integration__automation-fields">
            <label><span>Задержка после записи, сек</span><input type="number" min="0" max="600" value={settings.recording_delay_seconds} disabled={!isAdmin || Boolean(busy)} onChange={(event) => setSettings({ ...settings, recording_delay_seconds: Math.max(0, Math.min(600, Number(event.target.value) || 0)) })}/></label>
            <label><span>Макс. попыток</span><input type="number" min="1" max="10" value={settings.max_attempts} disabled={!isAdmin || Boolean(busy)} onChange={(event) => setSettings({ ...settings, max_attempts: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })}/></label>
            <label><span>Повтор через, мин</span><input type="number" min="1" max="1440" value={settings.retry_after_minutes} disabled={!isAdmin || Boolean(busy)} onChange={(event) => setSettings({ ...settings, retry_after_minutes: Math.max(1, Math.min(1440, Number(event.target.value) || 1)) })}/></label>
          </div>
          {isAdmin ? <button type="button" onClick={() => void saveProcessing()} disabled={Boolean(busy)}>{busy === 'settings' ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Сохранить автообработку</button> : <small>Изменять автообработку может только администратор.</small>}
        </div>
      </div>

      <aside className="zadarma-integration__side">
        <div><span>Контекст</span><strong>{scopeLabel}</strong><small>Внутренний номер: {status?.extension || form.pbxExtension || '—'}</small></div>
        <div><span>Webhook для Zadarma</span><code>{webhookUrl || 'Выберите клинику'}</code><button type="button" onClick={() => void copyWebhook()} disabled={!webhookUrl}><Clipboard size={15}/>{copied ? 'Скопировано' : 'Копировать URL'}</button></div>
        <div><span>Webhook health</span><strong>{webhookHealth?.healthy ? 'Конфигурация совпадает' : 'Не подтверждено'}</strong><small>Remote URL: {webhookHealth?.configuredUrl || '—'}</small><small>OUT_START: {webhookHealth?.notifications?.notify_out_start || '—'} · OUT_END: {webhookHealth?.notifications?.notify_out_end || '—'}</small></div>
        <div><span>Последний callback</span><strong>{callback?.status || 'Событий ещё нет'}</strong><small>{callback ? `${dateTime(callback.completed_at || callback.matched_at || callback.requested_at)} · PBX ${callback.pbx_call_id || '—'}` : 'Исходящие callback-запросы отсутствуют'}</small></div>
        <div><span>Последний звонок Zadarma</span><strong>{lastCall?.call_status || 'Звонков ещё нет'}</strong><small>{lastCall ? `${dateTime(lastCall.started_at)} · запись ${lastCall.recording_external_id ? 'получена' : 'нет'}` : 'Новых Zadarma-звонков IMDS пока не создавал'}</small></div>
        <div><span>Автообработка</span><strong>{settings.auto_transcribe ? 'Транскрипция включена' : 'Выключена'}</strong><small>{settings.auto_transcribe ? (settings.auto_analyze ? 'После текста запускается AI Call Intelligence' : 'Только текст, без автоматического AI-анализа') : 'Ручная кнопка в разделе «Звонки» остаётся доступной'}</small></div>
        <p>Webhook подписан и привязан к ID текущей клиники. IMDS не создаёт тестовый звонок при настройке — реальный health последнего события появится после первого исходящего вызова.</p>
      </aside>
    </div>
  </section>;
}
