import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Cable,
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Search,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import IntegrationManager from './components/IntegrationManager';
import {
  marketingApi,
  type AdSummaryRow,
  type DashboardDailyRow,
  type IntegrationStatus,
  type MarketingLead,
  type SourceSummaryRow,
} from './services/api';

const money = (value: number) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'KZT', maximumFractionDigits: 0,
}).format(Number(value || 0));
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
const romi = (revenue: number, spend: number) => spend ? Math.round(((revenue - spend) / spend) * 100) : 0;
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';

function useRemoteData<T>(loader: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loader()
      .then(result => { if (active) { setData(result); setError(null); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { data, loading, error };
}

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="heading"><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>;
}
function Card({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="metric"><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}
function Status({ loading, error, empty }: { loading: boolean; error: string | null; empty: boolean }) {
  if (loading) return <Panel title="Загрузка"><p className="note">Получаем реальные данные из Supabase через Cloudflare API…</p></Panel>;
  if (error) return <Panel title="Ошибка подключения"><p className="note">{error}</p></Panel>;
  if (empty) return <Panel title="Нет данных"><p className="note">Подключение работает, но таблицы Supabase пока пустые.</p></Panel>;
  return null;
}

function Dashboard() {
  const dailyState = useRemoteData<DashboardDailyRow[]>(() => marketingApi.dashboard(), []);
  const sourcesState = useRemoteData<SourceSummaryRow[]>(() => marketingApi.sources(), []);
  const [source, setSource] = useState('Все источники');

  const totals = useMemo(() => dailyState.data.reduce((acc, row) => ({
    leads: acc.leads + Number(row.leads || 0),
    target: acc.target + Number(row.target_leads || 0),
    arrived: acc.arrived + Number(row.arrived || 0),
    sales: acc.sales + Number(row.sales || 0),
    spend: acc.spend + Number(row.spend || 0),
    revenue: acc.revenue + Number(row.revenue || 0),
  }), { leads: 0, target: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 }), [dailyState.data]);

  const chartData = dailyState.data.map(row => ({
    ...row,
    dateLabel: new Date(`${row.date}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
  }));
  const visibleSources = source === 'Все источники' ? sourcesState.data : sourcesState.data.filter(row => row.source === source);
  const loading = dailyState.loading || sourcesState.loading;
  const error = dailyState.error || sourcesState.error;

  return <div className="stack">
    <div className="page-top">
      <Heading eyebrow="Marketing analytics" title="Дашборд маркетинга" text="Только реальные данные Supabase через Cloudflare Worker." />
      <select value={source} onChange={event => setSource(event.target.value)}>
        <option>Все источники</option>
        {sourcesState.data.map(row => <option key={`${row.source}-${row.platform}`}>{row.source}</option>)}
      </select>
    </div>
    <Status loading={loading} error={error} empty={!loading && !error && dailyState.data.length === 0 && sourcesState.data.length === 0} />
    {!loading && !error && <>
      <div className="metrics">
        <Card title="Все лиды" value={number(totals.leads)} detail="Из marketing_daily_metrics" />
        <Card title="Целевые лиды" value={number(totals.target)} detail={percent(totals.target, totals.leads)} />
        <Card title="Пришли" value={number(totals.arrived)} detail={percent(totals.arrived, totals.target)} />
        <Card title="Продажи" value={number(totals.sales)} detail={percent(totals.sales, totals.arrived)} />
        <Card title="Выручка" value={money(totals.revenue)} detail={`Средний чек ${money(totals.sales ? totals.revenue / totals.sales : 0)}`} />
        <Card title="Расход" value={money(totals.spend)} detail={`ROMI ${romi(totals.revenue, totals.spend)}%`} />
      </div>
      <div className="grid-2">
        <Panel title="Динамика лидов"><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity={.45}/><stop offset="1" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="dateLabel" stroke="#64748b"/><YAxis stroke="#64748b"/><Tooltip contentStyle={{background:'#0d1730',border:'1px solid #1e2d4a'}}/><Area dataKey="leads" stroke="#3b82f6" fill="url(#leadFill)"/></AreaChart></ResponsiveContainer></div></Panel>
        <Panel title="Выручка по дням"><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="dateLabel" stroke="#64748b"/><YAxis stroke="#64748b" tickFormatter={value => `${Math.round(Number(value)/1000000)}м`}/><Tooltip formatter={value => money(Number(value))} contentStyle={{background:'#0d1730',border:'1px solid #1e2d4a'}}/><Bar dataKey="revenue" fill="#22c55e" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div></Panel>
      </div>
      <Panel title="Источники и сквозная аналитика"><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Расход</th><th>Выручка</th><th>ROMI</th></tr></thead><tbody>{visibleSources.map(row => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b><small>{row.platform}</small></td><td>{number(row.leads)}</td><td>{number(row.target_leads)} <small>{percent(row.target_leads,row.leads)}</small></td><td>{number(row.arrived)}</td><td>{number(row.sales)}</td><td>{money(row.spend)}</td><td>{money(row.revenue)}</td><td className="good">{romi(row.revenue,row.spend)}%</td></tr>)}</tbody></table></div></Panel>
    </>}
  </div>;
}

function Leads() {
  const state = useRemoteData<MarketingLead[]>(() => marketingApi.listLeads({ limit: 500 }), []);
  const stages = ['Новый','Квалификация','Записан','Пришёл','Продажа','Отказ'];
  return <div className="stack">
    <Heading eyebrow="Sales CRM" title="Лиды" text="Реальные лиды из таблицы marketing_leads." />
    <Status loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.length === 0} />
    {!state.loading && !state.error && state.data.length > 0 && <>
      <div className="kanban">{stages.map(stage => <section key={stage}><header><b>{stage}</b><span>{state.data.filter(lead => lead.stage === stage).length}</span></header>{state.data.filter(lead => lead.stage === stage).map(lead => <article key={lead.id}><small>{lead.external_id || lead.id.slice(0,8)} · {lead.source || 'Источник не указан'}</small><strong>{lead.name}</strong><span>{lead.phone}</span><p>{lead.next_action || 'Нет следующего действия'}</p><footer>{lead.manager || 'Не назначен'}</footer></article>)}</section>)}</div>
      <Panel title="Все лиды"><div className="table-wrap"><table><thead><tr><th>ID</th><th>Клиент</th><th>Источник</th><th>Кампания</th><th>Менеджер</th><th>Стадия</th><th>Следующее действие</th></tr></thead><tbody>{state.data.map(lead => <tr key={lead.id}><td>{lead.external_id || lead.id.slice(0,8)}</td><td><b>{lead.name}</b><small>{lead.phone}</small></td><td>{lead.source || '—'}</td><td>{lead.campaign || lead.utm_campaign || '—'}</td><td>{lead.manager || '—'}</td><td><span className="badge">{lead.stage}</span></td><td>{lead.next_action || '—'}</td></tr>)}</tbody></table></div></Panel>
    </>}
  </div>;
}

function Ads() {
  const state = useRemoteData<AdSummaryRow[]>(() => marketingApi.ads(), []);
  return <div className="stack"><Heading eyebrow="Paid media" title="Рекламные объявления" text="Реальные расходы и CRM-конверсии из marketing_ads." />
    <Status loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.length === 0} />
    {!state.loading && !state.error && state.data.length > 0 && <Panel title="Объявления"><div className="table-wrap"><table><thead><tr><th>Платформа</th><th>Кампания / группа</th><th>Креатив</th><th>Статус</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды</th><th>Продажи</th><th>Выручка</th></tr></thead><tbody>{state.data.map(row => <tr key={row.row_key}><td><b>{row.platform}</b></td><td><b>{row.campaign_name}</b><small>{row.adset_name || '—'}</small></td><td>{row.creative_name || '—'}</td><td><span className={`badge ${row.status === 'ACTIVE' ? 'badge--green' : ''}`}>{row.status || '—'}</span></td><td>{money(row.spend)}</td><td>{number(row.impressions)}</td><td>{number(row.clicks)}</td><td>{number(row.leads)}</td><td>{number(row.sales)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div></Panel>}
  </div>;
}

function Conversions() {
  const state = useRemoteData<SourceSummaryRow[]>(() => marketingApi.sources(), []);
  const totals = state.data.reduce((acc,row) => ({ leads: acc.leads + Number(row.leads), target: acc.target + Number(row.target_leads), arrived: acc.arrived + Number(row.arrived), sales: acc.sales + Number(row.sales) }), { leads:0,target:0,arrived:0,sales:0 });
  const funnel: [string, number][] = [['Лиды',totals.leads],['Целевые',totals.target],['Пришли',totals.arrived],['Продажи',totals.sales]];
  return <div className="stack"><Heading eyebrow="Funnel" title="Конверсии" text="Конверсия рассчитывается по реальным агрегатам источников." /><Status loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.length===0}/>{!state.loading&&!state.error&&state.data.length>0&&<div className="grid-2"><Panel title="Воронка продаж"><div className="funnel">{funnel.map(([label,value],index)=><div key={label}><span>{label}</span><div><i style={{width:`${totals.leads ? value/totals.leads*100 : 0}%`}}/></div><b>{number(value)}</b>{index>0&&<small>{percent(value,funnel[index-1][1])}</small>}</div>)}</div></Panel><Panel title="Продажи по источникам"><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={state.data} layout="vertical"><CartesianGrid stroke="#1e2d4a" horizontal={false}/><XAxis type="number" stroke="#64748b"/><YAxis type="category" dataKey="source" stroke="#64748b" width={110}/><Tooltip contentStyle={{background:'#0d1730',border:'1px solid #1e2d4a'}}/><Bar dataKey="sales" fill="#8b5cf6" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div></Panel></div>}</div>;
}

function Creatives() {
  const state = useRemoteData<AdSummaryRow[]>(() => marketingApi.ads(), []);
  return <div className="stack"><Heading eyebrow="Creative intelligence" title="Анализ креативов" text="Креативы оцениваются по реальным кликам, лидам и продажам." /><Status loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.length===0}/>{!state.loading&&!state.error&&<div className="cards">{state.data.map(row => <article className="creative" key={row.row_key}><div className="creative__preview"><Sparkles size={28}/></div><small>{row.platform} · {row.creative_type || 'Формат не указан'}</small><h2>{row.creative_name || row.campaign_name}</h2><p>{row.campaign_name}</p><div><span>Расход <b>{money(row.spend)}</b></span><span>Лиды <b>{number(row.leads)}</b></span><span>Продажи <b>{number(row.sales)}</b></span><span>CTR <b>{percent(row.clicks,row.impressions)}</b></span></div></article>)}</div>}</div>;
}

function Integrations() {
  const empty: IntegrationStatus = {
    configured: { supabase:false, bitrix:false, bitrixWebhook:false, meta:false, metaWebhook:false, tiktok:false, tiktokWebhook:false, n8n:false, manualSync:false },
    runs: [],
  };
  const state = useRemoteData<IntegrationStatus>(() => marketingApi.integrationStatus(), empty);
  const cards = [
    ['Supabase', 'База данных и агрегаты', state.data.configured.supabase],
    ['Bitrix24 API', 'История лидов, сделок и стадий', state.data.configured.bitrix],
    ['Bitrix24 webhook', 'Новые и изменённые CRM-события', state.data.configured.bitrixWebhook],
    ['Meta Ads', 'Расходы, показы, клики и лиды', state.data.configured.meta],
    ['Meta Lead Ads', 'Лиды из встроенных форм', state.data.configured.metaWebhook],
    ['TikTok Ads', 'Рекламная статистика кабинетов', state.data.configured.tiktok],
    ['TikTok webhook', 'Лиды и события TikTok', state.data.configured.tiktokWebhook],
    ['n8n', 'Универсальный импорт и автоматизации', state.data.configured.n8n],
  ] as const;

  return <div className="stack">
    <Heading eyebrow="Data connections" title="Интеграции" text="Фактическое состояние подключений и последние синхронизации." />
    <Status loading={state.loading} error={state.error} empty={false} />
    {!state.loading && !state.error && <>
      <div className="cards">{cards.map(([name,text,configured])=><article className="integration" key={name}><div><Cable size={22}/></div><h2>{name}</h2><p>{text}</p><span className={`badge ${configured ? 'badge--green' : ''}`}>{configured ? 'Подключено' : 'Нужен секрет'}</span></article>)}</div>
      <Panel title="Последние синхронизации">
        {state.data.runs.length === 0 ? <p className="note">Синхронизации ещё не запускались.</p> : <div className="table-wrap"><table><thead><tr><th>Источник</th><th>Статус</th><th>Период</th><th>Получено</th><th>Записано</th><th>Запуск</th><th>Ошибка</th></tr></thead><tbody>{state.data.runs.map(run => <tr key={run.id}><td><b>{run.source}</b></td><td><span className={`badge ${run.status === 'success' ? 'badge--green' : ''}`}>{run.status}</span></td><td>{run.date_from || '—'} — {run.date_to || '—'}</td><td>{number(run.fetched)}</td><td>{number(run.written)}</td><td>{dateTime(run.started_at)}</td><td>{run.error || '—'}</td></tr>)}</tbody></table></div>}
      </Panel>
      <Panel title="Webhook endpoints"><p className="note">Bitrix: `/api/webhooks/bitrix` · Meta: `/api/webhooks/meta` · TikTok: `/api/webhooks/tiktok` · n8n: `/api/webhooks/n8n`</p></Panel>
    </>}
  </div>;
}

const nav = [
  ['/', 'Дашборд', LayoutDashboard], ['/leads','Лиды',UsersRound], ['/ads','Объявления',CircleDollarSign], ['/conversions','Конверсии',BarChart3], ['/creatives','Креативы',Sparkles], ['/integrations','Интеграции',Cable],
] as const;

function Shell() {
  const [open,setOpen]=useState(false);
  return <div className="shell"><aside className={open?'open':''}><div className="brand"><MessageSquareText/><div><b>AMANAT MED</b><span>Marketing</span></div></div><nav>{nav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/' as string} onClick={()=>setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav></aside><main><header className="topbar"><button onClick={()=>setOpen(!open)}><Menu/></button><div className="search"><Search size={17}/><input placeholder="Поиск лидов, кампаний и источников"/></div><div className="top-actions"><button><Bell size={18}/></button><span className="avatar">AM</span></div></header><div className="content"><Routes><Route path="/" element={<Dashboard/>}/><Route path="/leads" element={<Leads/>}/><Route path="/ads" element={<Ads/>}/><Route path="/conversions" element={<Conversions/>}/><Route path="/creatives" element={<Creatives/>}/><Route path="/integrations" element={<IntegrationManager/>}/></Routes></div></main></div>;
}

export default function App(){return <BrowserRouter><Shell/></BrowserRouter>}
