import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, PhoneIncoming } from 'lucide-react';
import { useAuth } from './AuthGate';
import '../zadarma-integration.css';

type Settings = {
  inbound_capture_enabled: boolean;
  missed_call_tasks_enabled: boolean;
  missed_call_task_delay_minutes: number;
  auto_transcribe?: boolean;
  auto_analyze?: boolean;
  recording_delay_seconds?: number;
  max_attempts?: number;
  retry_after_minutes?: number;
};

type ResponseShape = { settings: Settings };
const defaults: Settings = { inbound_capture_enabled: true, missed_call_tasks_enabled: true, missed_call_task_delay_minutes: 0 };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const raw = await response.text();
  let payload: unknown = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload as T;
}

export default function ZadarmaInboundControls() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [settings, setSettings] = useState<Settings>(defaults);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const result = await request<ResponseShape>('/api/integrations/zadarma/telephony-settings');
      setSettings({ ...defaults, ...result.settings });
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  useEffect(() => { void load(); }, [user.companyId]);

  const save = async () => {
    if (!isAdmin) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await request<ResponseShape>('/api/integrations/zadarma/telephony-settings', {
        method: 'PUT',
        body: JSON.stringify({
          inboundCaptureEnabled: settings.inbound_capture_enabled,
          missedCallTasksEnabled: settings.missed_call_tasks_enabled,
          missedCallTaskDelayMinutes: settings.missed_call_task_delay_minutes,
        }),
      });
      setSettings({ ...defaults, ...result.settings });
      setMessage('Настройки входящих звонков сохранены для выбранной клиники.');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return <section className="zadarma-integration zadarma-inbound-controls">
    <header className="zadarma-integration__head">
      <div className="zadarma-integration__brand">
        <span><PhoneIncoming size={22}/></span>
        <div>
          <small>INBOUND CALLS</small>
          <h2>Входящие звонки</h2>
          <p>Связывать звонок с пациентом по телефону, создавать нового лида при первом обращении и ставить CRM-задачу по пропущенному вызову.</p>
        </div>
      </div>
    </header>

    {message && <div className="zadarma-integration__message is-ok">{message}</div>}

    <div className="zadarma-integration__automation">
      <label className="zadarma-switch">
        <input type="checkbox" checked={settings.inbound_capture_enabled} disabled={!isAdmin || busy} onChange={(event) => setSettings({ ...settings, inbound_capture_enabled: event.target.checked })}/>
        <span>Принимать входящие звонки в IMDS</span>
      </label>
      <label className="zadarma-switch">
        <input type="checkbox" checked={settings.missed_call_tasks_enabled} disabled={!isAdmin || busy || !settings.inbound_capture_enabled} onChange={(event) => setSettings({ ...settings, missed_call_tasks_enabled: event.target.checked })}/>
        <span>Создавать CRM-задачу по пропущенному звонку</span>
      </label>
      <div className="zadarma-integration__automation-fields">
        <label>
          <span>Задержка задачи, мин</span>
          <input type="number" min="0" max="1440" value={settings.missed_call_task_delay_minutes} disabled={!isAdmin || busy || !settings.missed_call_tasks_enabled} onChange={(event) => setSettings({ ...settings, missed_call_task_delay_minutes: Math.max(0, Math.min(1440, Number(event.target.value) || 0)) })}/>
        </label>
      </div>
      {isAdmin ? <button type="button" onClick={() => void save()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Сохранить входящие</button> : <small>Изменять настройки может только администратор.</small>}
    </div>
  </section>;
}
