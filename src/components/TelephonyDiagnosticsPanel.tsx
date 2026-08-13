import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';

type Status = { provider?: string; providerLabel?: string; configured?: boolean; credentialScope?: string; capabilities?: string[] };
type Settings = { settings?: { auto_transcribe?: boolean; auto_analyze?: boolean; archive_recordings?: boolean; recording_retention_days?: number } };
type Provider = { provider?: string; configured?: boolean; status?: string; lastVerifiedAt?: string | null; lastError?: string | null };
type Providers = { providers?: Provider[] };

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(raw || `HTTP ${response.status}`);
  return (raw ? JSON.parse(raw) : {}) as T;
}

export default function TelephonyDiagnosticsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings['settings']>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const [nextStatus, nextSettings, nextProviders] = await Promise.all([
        read<Status>('/api/telephony/status'),
        read<Settings>('/api/telephony/settings').catch(() => ({ settings: {} })),
        read<Providers>('/api/telephony/providers').catch(() => ({ providers: [] })),
      ]);
      setStatus(nextStatus);
      setSettings(nextSettings.settings || {});
      setProviders(nextProviders.providers || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const automationReady = Boolean(settings?.auto_transcribe && settings?.auto_analyze);
  return <section className="zadarma-integration" aria-label="Диагностика телефонии">
    <header className="zadarma-integration__head">
      <div className="zadarma-integration__brand"><span>{status?.configured ? <CheckCircle2 size={22}/> : <CircleAlert size={22}/>}</span><div><small>TELEPHONY HEALTH</small><h2>Диагностика телефонии</h2><p>Показывает реальный активный provider и готовность автоматической обработки звонков без тестовых данных.</p></div></div>
      <button type="button" onClick={() => void load()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить</button>
    </header>
    {error && <div className="zadarma-integration__message is-error">{error}</div>}
    <div className="zadarma-integration__grid">
      <div className="zadarma-integration__form">
        <div className="zadarma-integration__automation"><div><span>Активный provider</span><p>{status?.providerLabel || status?.provider || 'Не определён'} · {status?.configured ? 'настроен' : 'credentials не настроены'}</p></div></div>
        <div className="zadarma-integration__automation"><div><span>Автоматическая обработка</span><p>{automationReady ? 'Транскрипция и AI-анализ включены' : 'Проверьте настройки транскрипции и AI'}</p></div></div>
        <div className="zadarma-integration__automation"><div><span>Архив записей</span><p>{settings?.archive_recordings ? `Включён · хранение ${settings.recording_retention_days || 365} дней` : 'Архивирование выключено'}</p></div></div>
        <div className="zadarma-integration__automation"><div><span>Capabilities</span><p>{status?.capabilities?.length ? status.capabilities.join(' · ') : 'Нет доступных функций для текущего provider'}</p></div></div>
        <div className="zadarma-integration__automation"><div><span>Сохранённые provider credentials</span><p>{providers.length ? providers.map((provider) => `${provider.provider}: ${provider.status || 'configured'}${provider.lastError ? ' (ошибка)' : ''}`).join(' · ') : 'Отдельные credentials пока не сохранены'}</p></div></div>
      </div>
    </div>
  </section>;
}
