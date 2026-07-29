import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Cable,
  ChartNoAxesCombined,
  LayoutDashboard,
  Menu,
  MessageCircleMore,
  MessageSquareText,
  Search,
  Tags,
  UsersRound,
  Workflow,
} from 'lucide-react';
import IntegrationManager from './components/IntegrationManager';
import {
  AttributionPage,
  CommunicationsPage,
  MarketingArchitecturePage,
  SalesPipelinePage,
} from './components/MarketingModules';
import {
  marketingApi,
  type AdSummaryRow,
  type DashboardDailyRow,
  type MarketingLead,
  type SourceSummaryRow,
} from './services/api';
import './marketing-platform.css';

type LoadState<T> = { data: T; loading: boolean; error: string | null };

function useRemoteData<T>(loader: () => Promise<T>, initial: T): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: initial, loading: true, error: null });
  useEffect(() => {
    let active = true;
    loader()
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((error) => active && setState({ data: initial, loading: false, error: error instanceof Error ? error.message : String(error) }));
    return () => { active = false; };
  }, []);
  return state;
}

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${(value * 100 / total).toFixed(1)}%` : '0%';

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="heading"><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>;
}

function StateBlock({ loading, error, empty }: { loading: boolean; error: string | null; empty: boolean }) {
  if (loading) return <section className="panel"><h2>Загрузка</h2><p className="note">Получаем данные из Cloudflare API и Supabase.</p></section>;
  if (error) return <section className="panel"><h2>Ошибка подключения</h2><p className="note">{error}</p></section>;
  if (empty) return <section className="panel"><h2>Нет данных</h2><p className="note">Источник подключён, но данные пока отсутствуют.</p></section>;
  return null;
}

function MarketingDashboard() {
  const daily = useRemoteData<DashboardDailyRow[]>(() => marketingApi.dashboard(), []);
  const sources = useRemoteData<SourceSummaryRow[]>(() => marketingApi.sources(), []);
  const totals = useMemo(() => daily.data.reduce((acc, row) => ({
    leads: acc.leads + Number(row.leads || 0),
    target: acc.target + Number(row.target_leads || 0),
    arrived: acc.arrived + Number(row.arrived || 0),
    sales: acc.sales + Number(row.sales || 0),
    spend: acc.spend + Number(row.spend || 0),
    revenue: acc.revenue + Number(row.revenue || 0),
  }), { leads: 0, target: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 }), [daily.data]);
  const loading = daily.loading || sources.loading;
  const error = daily.error || sources.error;

  return <div className="stack">
    <Heading eyebrow="1.6 Dashboard Marketing" title="Дашборд маркетинга" text="Сквозная аналитика рекламы, лидов, воронки, визитов, продаж и выручки." />
    <StateBlock loading={loading} error={error} empty={!loading && !error && daily.data.length === 0} />
    {!loading && !error && <>
      <section className="marketing-kpis">
        <article><span>Все лиды</span><strong>{number(totals.leads)}</strong><small>За выбранный период</small></article>
        <article><span>Целевые</span><strong>{number(totals.target)}</strong><small>{percent(totals.target, totals.leads)} от лидов</small></article>
        <article><span>Пришли</span><strong>{number(totals.arrived)}</strong><small>{percent(totals.arrived, totals.target)} от целевых</small></article>
        <article><span>Продажи</span><strong>{number(totals.sales)}</strong><small>{percent(totals.sales, totals.arrived)} от пришедших</small></article>
        <article><span>Выручка</span><strong>{money(totals.revenue)}</strong><small>Средний чек {money(totals.sales ? totals.revenue / totals.sales : 0)}</small></article>
        <article><span>Расход</span><strong>{money(totals.spend)}</strong><small>ROMI {totals.spend ? Math.round((totals.revenue - totals.spend) * 100 / totals.spend) : 0}%</small></article>
      </section>
      <section className="panel"><h2>Источники</h2><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Расход</th><th>Выручка</th></tr></thead><tbody>{sources.data.map((row) => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{number(row.arrived)}</td><td>{number(row.sales)}</td><td>{money(row.spend)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}

function LeadsPage() {
  const state = useRemoteData<MarketingLead[]>(() => marketingApi.listLeads({ limit: 500 }), []);
  return <div className="stack">
    <Heading eyebrow="1.1 Копия Bitrix24" title="Лиды" text="Единый список лидов, карточки, источники, UTM, менеджеры, стадии и следующие действия." />
    <StateBlock loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.length === 0} />
    {!state.loading && !state.error && state.data.length > 0 && <section className="panel"><h2>Все лиды</h2><div className="table-wrap"><table><thead><tr><th>ID</th><th>Клиент</th><th>Телефон</th><th>Источник</th><th>Кампания</th><th>Менеджер</th><th>Стадия</th><th>Следующее действие</th></tr></thead><tbody>{state.data.map((lead) => <tr key={lead.id}><td>{lead.external_id || lead.id.slice(0, 8)}</td><td><b>{lead.name}</b></td><td>{lead.phone}</td><td>{lead.source || '—'}</td><td>{lead.campaign || lead.utm_campaign || '—'}</td><td>{lead.manager || '—'}</td><td><span className="badge">{lead.stage}</span></td><td>{lead.next_action || '—'}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

function AdvertisingPage() {
  const state = useRemoteData<AdSummaryRow[]>(() => marketingApi.ads(), []);
  return <div className="stack">
    <Heading eyebrow="1.3 Рекламные кабинеты" title="Реклама" text="Meta SDK или n8n, затем TikTok: кампании, группы, объявления, расходы, лиды и продажи." />
    <StateBlock loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.length === 0} />
    {!state.loading && !state.error && state.data.length > 0 && <section className="panel"><h2>Кампании и объявления</h2><div className="table-wrap"><table><thead><tr><th>Платформа</th><th>Кампания</th><th>Группа</th><th>Креатив</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды</th><th>Продажи</th><th>Выручка</th></tr></thead><tbody>{state.data.map((row) => <tr key={row.row_key}><td><b>{row.platform}</b></td><td>{row.campaign_name}</td><td>{row.adset_name || '—'}</td><td>{row.creative_name || '—'}</td><td>{money(row.spend)}</td><td>{number(row.impressions)}</td><td>{number(row.clicks)}</td><td>{number(row.leads)}</td><td>{number(row.sales)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

const nav = [
  { to: '/', label: 'Dashboard Marketing', icon: LayoutDashboard, end: true },
  { to: '/leads', label: 'Лиды', icon: UsersRound },
  { to: '/pipeline', label: 'Воронка продаж', icon: Workflow },
  { to: '/communications', label: 'Коммуникации', icon: MessageCircleMore },
  { to: '/advertising', label: 'Реклама', icon: ChartNoAxesCombined },
  { to: '/attribution', label: 'UTM и атрибуция', icon: Tags },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { to: '/integrations', label: 'Интеграции', icon: Cable },
  { to: '/architecture', label: 'Архитектура', icon: Workflow },
];

function Shell() {
  const [open, setOpen] = useState(false);
  return <div className="marketing-shell">
    <aside className={open ? 'open' : ''}>
      <div className="marketing-brand"><MessageSquareText/><div><b>AMANAT MED</b><span>Marketing Platform</span></div></div>
      <div className="marketing-nav-label">МАРКЕТИНГ</div>
      <nav>{nav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
    </aside>
    <main>
      <header className="marketing-topbar">
        <button className="marketing-menu" type="button" onClick={() => setOpen(!open)}><Menu size={21}/></button>
        <div className="marketing-search"><Search size={17}/><input placeholder="Поиск лидов, кампаний, каналов и UTM"/></div>
        <div className="marketing-top-actions"><button type="button"><Bell size={18}/></button><span>AM</span></div>
      </header>
      <div className="marketing-content"><Routes>
        <Route path="/" element={<MarketingDashboard/>}/>
        <Route path="/leads" element={<LeadsPage/>}/>
        <Route path="/pipeline" element={<SalesPipelinePage/>}/>
        <Route path="/communications" element={<CommunicationsPage/>}/>
        <Route path="/advertising" element={<AdvertisingPage/>}/>
        <Route path="/attribution" element={<AttributionPage/>}/>
        <Route path="/analytics" element={<MarketingDashboard/>}/>
        <Route path="/integrations" element={<IntegrationManager/>}/>
        <Route path="/architecture" element={<MarketingArchitecturePage/>}/>
      </Routes></div>
    </main>
  </div>;
}

export default function MarketingPlatform() {
  return <BrowserRouter><Shell/></BrowserRouter>;
}
