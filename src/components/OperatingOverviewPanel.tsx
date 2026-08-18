import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Circle, Gauge, LoaderCircle, UsersRound } from 'lucide-react';
import { useAuth } from './AuthGate';
import { loadOperatingOverview, type OperatingOverview } from '../services/operatingOverview';
import { loadPlatformEntitlements, type PlatformEntitlements, type PlatformLimitKey } from '../services/platformEntitlements';
import './operating-overview.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const quotaLabels: Partial<Record<PlatformLimitKey, string>> = { clinics: 'Клиники', users: 'Пользователи', leads: 'Лиды', openTasks: 'Открытые задачи', integrations: 'Интеграции' };

export default function OperatingOverviewPanel() {
  const { user, switchCompany } = useAuth();
  const [data, setData] = useState<OperatingOverview | null>(null);
  const [platform, setPlatform] = useState<PlatformEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [next, entitlements] = await Promise.all([
        loadOperatingOverview(),
        loadPlatformEntitlements().catch(() => null),
      ]);
      setData(next);
      setPlatform(entitlements);
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
  const quotas = platform?.quota?.quotas || [];
  const quotaMap = useMemo(() => new Map(quotas.map((item) => [item.key, item])), [quotas]);

  const selectClinic = async (companyId: string) => {
    if (!companyId || companyId === user.companyId || switching) return;
    setSwitching(companyId);
    try { await switchCompany(companyId); }
    finally { setSwitching(''); }
  };

  if (loading) return <section className="operating-overview operating-overview--loading"><LoaderCircle className="spin" size={18}/>Проверяем состояние клиники…</section>;
  if (error || !current || !data) return null;

  const usageItems: Array<{ key: PlatformLimitKey; value: number }> = [
    { key: 'users', value: usage.users },
    { key: 'leads', value: usage.leads },
    { key: 'openTasks', value: usage.openTasks },
    { key: 'integrations', value: usage.integrations },
  ];

  return <section className="operating-overview">
    {needsOnboarding && <article className="operating-card onboarding-card">
      <div className="operating-card__head"><div><span className="operating-eyebrow">НАСТРОЙКА КЛИНИКИ</span><h2>Онбординг {current.onboarding.progress}%</h2><p>Прогресс считается по реальному состоянию сервисов и команды.</p></div><div className="onboarding-ring" aria-label={`Онбординг ${current.onboarding.progress}%`}><strong>{current.onboarding.progress}%</strong></div></div>
      <div className="onboarding-progress"><i style={{ width: `${current.onboarding.progress}%` }}/></div>
      <div className="onboarding-items">{current.onboarding.items.map((item) => <div className={item.done ? 'done' : ''} key={item.id}>{item.done ? <CheckCircle2 size={17}/> : <Circle size={17}/>}<span><strong>{item.label}</strong><small>{item.hint}</small></span></div>)}</div>
    </article>}

    {networkMode && <article className="operating-card network-card">
      <div className="operating-card__head"><div><span className="operating-eyebrow">MULTI-CLINIC</span><h2>Сеть клиник</h2><p>Сводка по всем клиникам, к которым у вас есть доступ.</p></div><Building2 size={24}/></div>
      <div className="network-kpis"><div><span>Клиники</span><strong>{number(data.network.clinics)}</strong></div><div><span>Сотрудники</span><strong>{number(data.network.users)}</strong></div><div><span>Лиды</span><strong>{number(data.network.leads)}</strong></div><div><span>Продажи</span><strong>{number(data.network.sales)}</strong></div><div><span>Выручка</span><strong>{money(data.network.revenueKzt)}</strong></div><div><span>Открытые задачи</span><strong>{number(data.network.openTasks)}</strong></div></div>
      <div className="clinic-strip">{data.clinics.map((clinic) => <button type="button" className={clinic.current ? 'active' : ''} key={clinic.id} onClick={() => void selectClinic(clinic.id)} disabled={Boolean(switching) || clinic.current}><span><Building2 size={16}/><b>{clinic.name}</b></span><small>{clinic.role} · onboarding {clinic.onboarding.progress}%</small><em>{clinic.current ? 'Текущая' : switching === clinic.id ? 'Переключение…' : `${number(clinic.performance.sales)} продаж`}</em></button>)}</div>
      {data.truncated && <p className="operating-note">Показаны первые {data.clinics.length} из {data.totalAccessibleClinics} доступных клиник.</p>}
    </article>}

    <article className="operating-card usage-card">
      <div className="operating-card__head"><div><span className="operating-eyebrow">USAGE / LIMITS</span><h2>Использование</h2><p>{platform?.managed ? 'Квоты синхронизируются из IMDS Control Plane.' : 'Фактические показатели; Control Plane пока не назначил числовые квоты.'}</p></div><Gauge size={24}/></div>
      <div className="usage-grid">
        {usageItems.map(({ key, value }) => {
          const quota = quotaMap.get(key);
          const statusClass = quota && quota.level !== 'ok' ? ` quota-${quota.level}` : '';
          return <div className={statusClass.trim()} key={key}><UsersRound size={18}/><span>{quotaLabels[key] || key}</span><strong>{quota ? `${number(quota.used)} / ${number(quota.limit)}` : number(value)}</strong>{quota ? <><div className="usage-meter"><i style={{ width: `${Math.min(100, quota.percent)}%` }}/></div><small>{quota.percent.toFixed(1)}% · {quota.enforcement === 'soft' ? 'soft limit' : quota.level === 'exceeded' ? 'лимит достигнут' : `${number(quota.remaining)} доступно`}</small></> : <small>без заданного лимита</small>}</div>;
        })}
        {quotaMap.has('clinics') && <div className={`quota-${quotaMap.get('clinics')!.level}`}><Building2 size={18}/><span>Клиники</span><strong>{number(quotaMap.get('clinics')!.used)} / {number(quotaMap.get('clinics')!.limit)}</strong><div className="usage-meter"><i style={{ width: `${Math.min(100, quotaMap.get('clinics')!.percent)}%` }}/></div><small>{quotaMap.get('clinics')!.percent.toFixed(1)}% · {number(quotaMap.get('clinics')!.remaining)} доступно</small></div>}
      </div>
    </article>
  </section>;
}
