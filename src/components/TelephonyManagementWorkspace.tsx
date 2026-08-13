import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, CheckCircle2, Clock3, Headphones, PhoneCall, RefreshCw, UserRoundCheck, UsersRound } from 'lucide-react';
import { marketingApi, type TelephonyAnalyticsResponse } from '../services/api';

type Mode = 'supervisor' | 'analytics';
type PeriodPreset = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0))} ₸`;
const percent = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const isoDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

function presetDates(preset: PeriodPreset): { from: string; to: string } {
  if (preset === 'all' || preset === 'custom') return { from: '', to: '' };
  const to = new Date();
  const from = new Date(to);
  if (preset === '7d') from.setDate(from.getDate() - 6);
  if (preset === '30d') from.setDate(from.getDate() - 29);
  if (preset === '90d') from.setDate(from.getDate() - 89);
  return { from: isoDate(from), to: isoDate(to) };
}

function toServerRange(from: string, to: string) {
  return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
}

export default function TelephonyManagementWorkspace({ mode }: { mode: Mode }) {
  const [analytics, setAnalytics] = useState<TelephonyAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [from, setFrom] = useState(() => presetDates('30d').from);
  const [to, setTo] = useState(() => presetDates('30d').to);
  const [operator, setOperator] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const invalidRange = Boolean(from && to && from > to);

  useEffect(() => {
    if (invalidRange) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const range = toServerRange(from, to);
    marketingApi.callAnalytics({
      ...range,
      operator: operator === 'all' ? undefined : operator,
    }).then((payload) => {
      if (!cancelled) setAnalytics(payload);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [from, to, operator, refreshKey, invalidRange]);

  const choosePreset = (next: PeriodPreset) => {
    setPreset(next);
    if (next !== 'custom') {
      const range = presetDates(next);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const operatorMetrics = analytics?.operators || [];
  const operatorNames = useMemo(() => operatorMetrics.map((item) => item.name), [operatorMetrics]);
  const totals = analytics?.selected;
  const overallTotals = analytics?.overall;
  const recent = analytics?.recent || [];

  useEffect(() => {
    if (operator === 'all' || operatorNames.includes(operator)) return;
    setOperator('all');
  }, [operator, operatorNames]);

  return <section className={`telephony-management telephony-management--${mode}`}>
    <header className="telephony-management__head">
      <div>
        {mode === 'supervisor' ? <Headphones size={18}/> : <BarChart3 size={18}/>} 
        <div><strong>{mode === 'supervisor' ? 'Supervisor' : 'Аналитика телефонии'}</strong><small>{mode === 'supervisor' ? 'Контроль операторов и текущей нагрузки' : 'Полная серверная аналитика без лимита истории'}</small></div>
      </div>
      <button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''}/>Обновить</button>
    </header>

    <div className="telephony-management__filters">
      <div className="telephony-management__presets" aria-label="Период аналитики">
        {([['today','Сегодня'],['7d','7 дней'],['30d','30 дней'],['90d','90 дней'],['all','Весь период']] as Array<[PeriodPreset,string]>).map(([value, label]) => <button type="button" key={value} className={preset === value ? 'active' : ''} onClick={() => choosePreset(value)}>{label}</button>)}
      </div>
      <label><CalendarDays size={14}/><span>С</span><input type="date" value={from} max={to || undefined} onChange={(event) => { setPreset('custom'); setFrom(event.target.value); }}/></label>
      <label><CalendarDays size={14}/><span>По</span><input type="date" value={to} min={from || undefined} onChange={(event) => { setPreset('custom'); setTo(event.target.value); }}/></label>
      <label className="telephony-management__operator-filter"><UsersRound size={14}/><span>Оператор</span><select value={operator} onChange={(event) => setOperator(event.target.value)}><option value="all">Все операторы</option>{operatorNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>

    {invalidRange && <div className="telephony-management__state telephony-management__state--error">Дата «С» не может быть позже даты «По».</div>}
    {error && <div className="telephony-management__state telephony-management__state--error">{error}</div>}
    {loading && !analytics ? <div className="telephony-management__state">Считаем аналитику телефонии…</div> : !invalidRange && totals && overallTotals && <>
      <div className="telephony-management__kpis">
        <article><PhoneCall/><span>Звонки</span><strong>{number(totals.calls)}</strong><small>{operator === 'all' ? 'Все операторы' : operator}</small></article>
        <article><CheckCircle2/><span>Завершено</span><strong>{number(totals.completed)}</strong><small>{percent(totals.completed, totals.calls)} от звонков</small></article>
        <article><UserRoundCheck/><span>Записи</span><strong>{number(totals.appointments)}</strong><small>{percent(totals.appointments, totals.completed || totals.calls)} конверсия</small></article>
        <article><Clock3/><span>Средняя длительность</span><strong>{Math.floor(totals.averageDuration / 60)}:{String(Math.round(totals.averageDuration) % 60).padStart(2, '0')}</strong></article>
        <article><BarChart3/><span>Средняя оценка</span><strong>{totals.averageQuality == null ? '—' : Number(totals.averageQuality).toFixed(1)}</strong><small>{totals.averageQuality == null ? 'Нет оценённых звонков' : 'из 100'}</small></article>
      </div>

      {mode === 'supervisor' ? <div className="telephony-management__grid">
        <section className="telephony-management__panel">
          <header><UsersRound size={16}/><strong>Операторы</strong><span>{operatorMetrics.length}</span></header>
          <div className="telephony-management__table">
            <div className="telephony-management__tr telephony-management__tr--head"><span>Оператор</span><span>Звонки</span><span>Записи</span><span>Конверсия</span><span>Качество</span></div>
            {operatorMetrics.map((item) => <button type="button" className={`telephony-management__tr telephony-management__tr--button ${operator === item.name ? 'active' : ''}`} key={item.name} onClick={() => setOperator(operator === item.name ? 'all' : item.name)}>
              <strong>{item.name}</strong><span>{number(item.calls)}</span><span>{number(item.appointments)}</span><span>{percent(item.appointments, item.completed || item.calls)}</span><span>{item.averageQuality == null ? '—' : Number(item.averageQuality).toFixed(1)}</span>
            </button>)}
            {!operatorMetrics.length && <div className="telephony-management__empty">Нет данных по операторам за выбранный период.</div>}
          </div>
        </section>
        <section className="telephony-management__panel">
          <header><PhoneCall size={16}/><strong>Последние звонки</strong><span>{number(totals.calls)}</span></header>
          <div className="telephony-management__recent">
            {recent.map((call) => <article key={call.id}><div><strong>{call.client_name || call.client_phone || 'Клиент'}</strong><small>{call.operator_name || 'Не назначен'} · {dateTime(call.started_at)}</small></div><span>{call.call_status || '—'}</span></article>)}
            {!recent.length && <div className="telephony-management__empty">История звонков за выбранный период пуста.</div>}
          </div>
        </section>
      </div> : <>
        <div className="telephony-management__conversion-summary">
          <section className="telephony-management__panel">
            <header><BarChart3 size={16}/><strong>Общая конверсия</strong><span>{number(overallTotals.calls)} звонков</span></header>
            <div className="telephony-management__analytics-list">
              <div><span>Звонок → завершён</span><strong>{percent(overallTotals.completed, overallTotals.calls)}</strong></div>
              <div><span>Завершён → запись</span><strong>{percent(overallTotals.appointments, overallTotals.completed || overallTotals.calls)}</strong></div>
              <div><span>Есть следующий шаг</span><strong>{percent(overallTotals.followUps, overallTotals.calls)}</strong></div>
              <div><span>Звонки с AI-оценкой</span><strong>{percent(overallTotals.scored, overallTotals.calls)}</strong></div>
            </div>
          </section>
          {operator !== 'all' && <section className="telephony-management__panel telephony-management__panel--accent">
            <header><UserRoundCheck size={16}/><strong>Конверсия: {operator}</strong><span>{number(totals.calls)} звонков</span></header>
            <div className="telephony-management__analytics-list">
              <div><span>Звонок → завершён</span><strong>{percent(totals.completed, totals.calls)}</strong></div>
              <div><span>Завершён → запись</span><strong>{percent(totals.appointments, totals.completed || totals.calls)}</strong></div>
              <div><span>Есть следующий шаг</span><strong>{percent(totals.followUps, totals.calls)}</strong></div>
              <div><span>Средняя оценка</span><strong>{totals.averageQuality == null ? '—' : Number(totals.averageQuality).toFixed(1)}</strong></div>
            </div>
          </section>}
        </div>

        <section className="telephony-management__panel telephony-management__funnel">
          <header><BarChart3 size={16}/><strong>Полная CRM-конверсия после звонка</strong><span>{number(totals.linkedLeads)} связанных лидов</span></header>
          <div className="telephony-management__funnel-grid">
            <article><span>Связанные лиды</span><strong>{number(totals.linkedLeads)}</strong><small>100%</small></article>
            <article><span>Записались</span><strong>{number(totals.funnelAppointments)}</strong><small>{percent(totals.funnelAppointments, totals.linkedLeads)}</small></article>
            <article><span>Пришли</span><strong>{number(totals.arrived)}</strong><small>{percent(totals.arrived, totals.linkedLeads)}</small></article>
            <article><span>Продажи</span><strong>{number(totals.sales)}</strong><small>{percent(totals.sales, totals.linkedLeads)}</small></article>
            <article><span>Выручка</span><strong>{money(totals.revenue)}</strong><small>после звонков</small></article>
          </div>
        </section>

        <section className="telephony-management__panel telephony-management__operator-conversion">
          <header><UsersRound size={16}/><strong>Конверсия по каждому оператору</strong><span>{operatorMetrics.length}</span></header>
          <div className="telephony-management__conversion-table telephony-management__conversion-table--wide">
            <div className="telephony-management__conversion-row telephony-management__conversion-row--head"><span>Оператор</span><span>Звонки</span><span>Записи</span><span>Пришли</span><span>Продажи</span><span>В запись</span><span>В продажу</span><span>Качество</span></div>
            {operatorMetrics.map((item) => <button type="button" className={`telephony-management__conversion-row ${operator === item.name ? 'active' : ''}`} key={item.name} onClick={() => setOperator(operator === item.name ? 'all' : item.name)}>
              <strong>{item.name}</strong><span>{number(item.calls)}</span><span>{number(item.funnelAppointments || item.appointments)}</span><span>{number(item.arrived)}</span><span>{number(item.sales)}</span><span><b>{percent(item.funnelAppointments || item.appointments, item.linkedLeads || item.completed || item.calls)}</b></span><span><b>{percent(item.sales, item.linkedLeads)}</b></span><span>{item.averageQuality == null ? '—' : Number(item.averageQuality).toFixed(1)}</span>
            </button>)}
            {!operatorMetrics.length && <div className="telephony-management__empty">Нет данных за выбранный период.</div>}
          </div>
        </section>
      </>}
    </>}
  </section>;
}
