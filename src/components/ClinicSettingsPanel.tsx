import { useEffect, useState } from 'react';
import { Building2, LoaderCircle, Save } from 'lucide-react';
import { useAuth } from './AuthGate';
import { loadClinicSettings, saveClinicSettings, type ClinicSettings } from '../services/account';

const TIMEZONES = [
  'Asia/Almaty',
  'Asia/Aqtobe',
  'Asia/Atyrau',
  'Asia/Aqtau',
  'Asia/Oral',
  'Asia/Bishkek',
  'Asia/Tashkent',
  'Asia/Dushanbe',
  'Asia/Ashgabat',
  'Asia/Baku',
  'Asia/Tbilisi',
  'Europe/Moscow',
  'Europe/Istanbul',
  'UTC',
];

const roleLabels: Record<string, string> = {
  owner: 'Владелец', administrator: 'Администратор', manager: 'Менеджер', marketer: 'Маркетолог',
  operator: 'Оператор', analyst: 'Аналитик', viewer: 'Наблюдатель', super_admin: 'Super Admin',
};

export default function ClinicSettingsPanel() {
  const { user } = useAuth();
  const currentCompany = user.companies?.find((company) => company.id === user.companyId) || user.companies?.[0];
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [timezone, setTimezone] = useState('Asia/Almaty');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice('');
    void loadClinicSettings()
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setTimezone(next.timezone || 'Asia/Almaty');
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.companyId]);

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const next = await saveClinicSettings(timezone);
      setSettings(next);
      setTimezone(next.timezone);
      setNotice('Часовой пояс клиники сохранён. Аналитика будет пересчитана в локальном времени.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить настройки клиники');
    } finally {
      setSaving(false);
    }
  };

  return <section>
    <h3>Текущая клиника</h3>
    <p>Настройки tenant-контекста организации. Часовой пояс используется для аналитики по часам, дням недели и локальным календарным датам.</p>
    <div className="organization-summary"><span><Building2 size={21}/></span><div><strong>{settings?.name || currentCompany?.name || 'Клиника не выбрана'}</strong><small>{roleLabels[currentCompany?.role || ''] || currentCompany?.role}</small></div></div>
    {error && <div className="workspace-message workspace-message--error">{error}</div>}
    {notice && <div className="workspace-message workspace-message--notice">{notice}</div>}
    {loading ? <div className="users-loading"><LoaderCircle className="spin"/>Загрузка настроек клиники…</div> : <>
      {currentCompany && <div className="access-list"><div><span>Tenant ID</span><em>{currentCompany.id}</em></div><div><span>Адрес</span><em>{settings?.slug || currentCompany.slug || '—'}</em></div><div><span>Статус</span><em>{currentCompany.status}</em></div></div>}
      <div className="workspace-card">
        <h4>Локальное время клиники</h4>
        <div className="profile-grid">
          <label className="profile-grid-full"><span>Часовой пояс</span><select value={timezone} onChange={(event) => setTimezone(event.target.value)}>{TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        </div>
        <div className="workspace-note">Это настройка клиники, а не личный часовой пояс пользователя. Она применяется ко всем сотрудникам при расчёте маркетинговой аналитики.</div>
        <div className="workspace-actions"><button className="workspace-primary" type="button" disabled={saving || timezone === settings?.timezone} onClick={() => void save()}><Save size={15}/>{saving ? 'Сохранение…' : 'Сохранить timezone'}</button></div>
      </div>
    </>}
  </section>;
}
