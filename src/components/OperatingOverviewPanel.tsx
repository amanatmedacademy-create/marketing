import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Circle, Gauge, LoaderCircle, UsersRound } from 'lucide-react';
import { useAuth } from './AuthGate';
import { loadOperatingOverview, type OperatingOverview } from '../services/operatingOverview';
import './operating-overview.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));

export default function OperatingOverviewPanel() {
  const { user, switchCompany } = useAuth();
  const [data, setData] = useState<OperatingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const next = await loadOperatingOverview();
      setData(next);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [user.companyId]);

  const current = data?.current || null;
  const needsOnboarding = Boolean(current && current.onboarding.progress < 100);
  const networkMode = Number(data?.clinics.length || 0) > 1;
  const usage = useMemo(() => current?.usage || { users: 0, leads: 0, openTasks: 0, integrations: 0 }, [current]);

  const selectClinic = async (companyId: string) => {
    if (!companyId || companyId === user.companyId || switching) return;
    setSwitching(companyId);
    try { await switchCompany(companyId); }
    finally { setSwitching(''); }
  };

  if (loading) return <section className="operating-overview operating-overview--loading"><LoaderCircle className="spin" size={18}/>Проверяем состояние клиники…</section>;
  if (error || !current || !data) return null;

  return <section className="operating-overview">
    {needsOnboarding && <article className="operating-card onboarding-card">
      <div className="operating-card__head">
        <div><span className="operating-eyebrow">НАСТРОЙКА КЛИНИКИ</span><h2>Онбординг {current.onboarding.progress}%</h2><p>Прогресс считается по реальному состоянию сервисов и команды.</p></div>
        <div className="onboarding-ring" aria-label={`Онбординг ${current.onboarding.progress}%`}><strong>{current.onboarding.progress}%</strong></div>
      </div>
      <div className="onboarding-progress"><i style={{ width: `${current.onboarding.progress}%` }}/></div>
      <div className="onboarding-items">{current.onboarding.items.map((item) => <div className={item.done ? 'done' : ''} key={item.id}>{item.done ? <CheckCircle2 size={17}/> : <Circle size={17}/>}<span><strong>{item.label}</strong><small>{item.hint}</small></span></div>)}</div>
    </article>}

    {networkMode && <article className="operating-card network-card">
      <div className="operating-card__head"><div><span className="operating-eyebrow">MULTI-CLINIC</span><h2>Сеть клиник</h2><p>Сводка по всем клиникам, к которым у вас есть доступ.</p></div><Building2 size={24}/></div>
      <div className="network-kpis">
        <div><span>Клиники</span><strong>{number(data.network.clinics)}</strong></div>
        <div><span>Сотрудники</span><strong>{number(data.network.users)}</strong></div>
        <div><span>Лиды</span><strong>{number(data.network.leads)}</strong></div>
        <div><span>Продажи</span><strong>{number(data.network.sales)}</strong></div>
        <div><span>Выручка</span><strong>{money(data.network.revenueKzt)}</strong></div>
        <div><span>Открытые задачи</span><strong>{number(data.network.openTasks)}</strong></div>
      </div>
      <div className="clinic-strip">{data.clinics.map((clinic) => <button type="button" className={clinic.current ? 'active' : ''} key={clinic.id} onClick={() => void selectClinic(clinic.id)} disabled={Boolean(switching) || clinic.current}>
        <span><Building2 size={16}/><b>{clinic.name}</b></span>
        <small>{clinic.role} · onboarding {clinic.onboarding.progress}%</small>
        <em>{clinic.current ? 'Текущая' : switching === clinic.id ? 'Переключение…' : `${number(clinic.performance.sales)} продаж`}</em>
      </button>)}</div>
      {data.truncated && <p className="operating-note">Показаны первые {data.clinics.length} из {data.totalAccessibleClinics} доступных клиник.</p>}
    </article>}

    <article className="operating-card usage-card">
      <div className="operating-card__head"><div><span className="operating-eyebrow">USAGE / LIMITS</span><h2>Использование</h2><p>Фактические показатели текущей клиники. Лимиты применяются только когда их передаёт IMDS Control Plane.</p></div><Gauge size={24}/></div>
      <div className="usage-grid">
        <div><UsersRound size={18}/><span>Пользователи</span><strong>{number(usage.users)}</strong><small>без заданного лимита</small></div>
        <div><Gauge size={18}/><span>Лиды</span><strong>{number(usage.leads)}</strong><small>фактический объём</small></div>
        <div><CheckCircle2 size={18}/><span>Открытые задачи</span><strong>{number(usage.openTasks)}</strong><small>текущая нагрузка</small></div>
        <div><Building2 size={18}/><span>Интеграции</span><strong>{number(usage.integrations)}</strong><small>активные подключения</small></div>
      </div>
    </article>
  </section>;
}
