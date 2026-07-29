import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { BarChart3, Bell, Cable, ChartNoAxesCombined, FileText, History, LayoutDashboard, Menu, MessageCircle, MessageSquareText, Search, ServerCog, Settings, ShieldCheck, Tags, TriangleAlert, UsersRound, Workflow } from 'lucide-react';
import AdsManagerPage from './components/AdsManagerPage';
import AnalyticsWorkspace from './components/AnalyticsWorkspace';
import IntegrationManager from './components/IntegrationManager';
import MarketingChatBox from './components/MarketingChatBox';
import MarketingDashboardSummary from './components/MarketingDashboardSummary';
import UserWorkspaceModal from './components/UserWorkspaceModal';
import { AttributionPage, MarketingArchitecturePage, SalesPipelinePage } from './components/MarketingModules';
import { marketingApi, type IntegrationStatus, type MarketingLead } from './services/api';
import { useAuth } from './components/AuthGate';
import './marketing-platform.css';
import './journal.css';

type LoadState<T> = { data: T; loading: boolean; error: string | null };
type JournalTab = 'logs' | 'sync' | 'audit' | 'errors' | 'system';
type WorkspaceMode = 'profile' | 'settings' | null;

function useRemoteData<T>(loader: () => Promise<T>, initial: T): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: initial, loading: true, error: null });
  useEffect(() => {
    let active = true;
    loader().then((data) => active && setState({ data, loading: false, error: null })).catch((error) => active && setState({ data: initial, loading: false, error: error instanceof Error ? error.message : String(error) }));
    return () => { active = false; };
  }, []);
  return state;
}

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="heading"><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>;
}

function StateBlock({ loading, error, empty }: { loading: boolean; error: string | null; empty: boolean }) {
  if (loading) return <section className="panel"><h2>Загрузка</h2><p className="note">Получаем данные из Cloudflare API и Supabase.</p></section>;
  if (error) return <section className="panel"><h2>Ошибка подключения</h2><p className="note">{error}</p></section>;
  if (empty) return <section className="panel"><h2>Нет данных</h2><p className="note">Источник подключён, но данные пока отсутствуют.</p></section>;
  return null;
}

function LeadsPage() {
  const state = useRemoteData<MarketingLead[]>(() => marketingApi.listLeads({ limit: 500 }), []);
  return <div className="stack">
    <Heading eyebrow="1.1 Копия Bitrix24" title="Лиды" text="Единый список лидов, карточки, источники, UTM, менеджеры, стадии и следующие действия." />
    <StateBlock loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.length === 0} />
    {!state.loading && !state.error && state.data.length > 0 && <section className="panel"><h2>Все лиды</h2><div className="table-wrap"><table><thead><tr><th>ID</th><th>Клиент</th><th>Телефон</th><th>Источник</th><th>Кампания</th><th>Менеджер</th><th>Стадия</th><th>Следующее действие</th></tr></thead><tbody>{state.data.map((lead) => <tr key={lead.id}><td>{lead.external_id || lead.id.slice(0, 8)}</td><td><b>{lead.name}</b></td><td>{lead.phone}</td><td>{lead.source || '—'}</td><td>{lead.campaign || lead.utm_campaign || '—'}</td><td>{lead.manager || '—'}</td><td><span className="badge">{lead.stage}</span></td><td>{lead.next_action || '—'}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

function JournalPlaceholder({ title, text }: { title: string; text: string }) {
  return <section className="panel journal-placeholder"><h2>{title}</h2><p>{text}</p><span>Раздел подготовлен. Источник данных будет подключён на следующем этапе.</span></section>;
}

function JournalPage() {
  const [tab, setTab] = useState<JournalTab>('sync');
  const empty: IntegrationStatus = { configured: { supabase: false, bitrix: false, bitrixWebhook: false, meta: false, metaWebhook: false, tiktok: false, tiktokWebhook: false, n8n: false, manualSync: false }, runs: [] };
  const state = useRemoteData<IntegrationStatus>(() => marketingApi.integrationStatus(), empty);
  const tabs: Array<{ id: JournalTab; label: string; icon: typeof History }> = [
    { id: 'logs', label: 'Логи', icon: FileText }, { id: 'sync', label: 'Синхронизации', icon: History }, { id: 'audit', label: 'Аудит', icon: ShieldCheck }, { id: 'errors', label: 'Ошибки', icon: TriangleAlert }, { id: 'system', label: 'Системные события', icon: ServerCog },
  ];
  return <div className="stack journal-page">
    <Heading eyebrow="System journal" title="Журнал" text="Логи, синхронизации, аудит действий, ошибки и системные события IMDS Marketing." />
    <nav className="journal-tabs" aria-label="Разделы журнала">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16}/><span>{label}</span></button>)}</nav>
    {tab === 'sync' && <><StateBlock loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.data.runs.length === 0} />{!state.loading && !state.error && state.data.runs.length > 0 && <section className="panel"><div className="journal-panel-head"><div><h2>Журнал синхронизаций</h2><p>Все запуски обмена с Bitrix24, Meta, TikTok, n8n и другими источниками.</p></div><span>{state.data.runs.length} записей</span></div><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Статус</th><th>Период данных</th><th>Получено</th><th>Записано</th><th>Запущено</th><th>Ошибка</th></tr></thead><tbody>{state.data.runs.map((run) => <tr key={run.id}><td><b>{run.source}</b></td><td><span className={`badge ${run.status === 'success' ? 'badge--green' : ''}`}>{run.status === 'success' ? 'Успешно' : run.status === 'failed' ? 'Ошибка' : run.status === 'running' ? 'Выполняется' : run.status}</span></td><td>{run.date_from || '—'} — {run.date_to || '—'}</td><td>{number(run.fetched)}</td><td>{number(run.written)}</td><td>{dateTime(run.started_at)}</td><td>{run.error || '—'}</td></tr>)}</tbody></table></div></section>}</>}
    {tab === 'logs' && <JournalPlaceholder title="Логи" text="Технические и прикладные события API, webhooks, импортов и фоновых задач." />}
    {tab === 'audit' && <JournalPlaceholder title="Аудит действий" text="История входов, изменений настроек, интеграций, лидов, стадий и ответственных." />}
    {tab === 'errors' && <JournalPlaceholder title="Ошибки" text="Централизованный список ошибок интеграций, API, синхронизаций и обработки данных." />}
    {tab === 'system' && <JournalPlaceholder title="Системные события" text="Деплои, планировщик, состояние сервисов, фоновые процессы и изменения конфигурации." />}
  </div>;
}

const nav = [
  { to: '/', label: 'Dashboard Marketing', icon: LayoutDashboard, end: true }, { to: '/chat', label: 'Чат', icon: MessageCircle }, { to: '/leads', label: 'Лиды', icon: UsersRound }, { to: '/pipeline', label: 'Воронка продаж', icon: Workflow }, { to: '/advertising', label: 'Реклама', icon: ChartNoAxesCombined }, { to: '/attribution', label: 'UTM и атрибуция', icon: Tags }, { to: '/analytics', label: 'Аналитика', icon: BarChart3 }, { to: '/integrations', label: 'Интеграции', icon: Cable }, { to: '/journal', label: 'Журнал', icon: History }, { to: '/architecture', label: 'Архитектура', icon: Workflow },
];

function Shell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceMode>(null);
  const initials = (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return <div className="marketing-shell">
    <aside className={open ? 'open' : ''}><div className="marketing-brand"><MessageSquareText/><div><b>IMDS</b><span>Marketing</span></div></div><div className="marketing-nav-label">МАРКЕТИНГ</div><nav>{nav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav></aside>
    <main><header className="marketing-topbar"><button className="marketing-menu" type="button" onClick={() => setOpen(!open)}><Menu size={21}/></button><div className="marketing-search"><Search size={17}/><input placeholder="Поиск лидов, кампаний, каналов и UTM"/></div><div className="marketing-top-actions"><button type="button" aria-label="Уведомления" onClick={() => setWorkspace('profile')}><Bell size={18}/></button>{user.role === 'administrator' && <button className="topbar-settings-button" type="button" aria-label="Настройки" onClick={() => setWorkspace('settings')}><Settings size={17}/></button>}<button className="topbar-profile-button" type="button" onClick={() => setWorkspace('profile')}><span>{initials}</span><div><strong>{user.name || 'Администратор'}</strong><small>{user.role === 'administrator' ? 'Полный доступ' : user.role}</small></div></button></div></header>
      <div className="marketing-content"><Routes><Route path="/" element={<MarketingDashboardSummary/>}/><Route path="/chat" element={<MarketingChatBox/>}/><Route path="/leads" element={<LeadsPage/>}/><Route path="/pipeline" element={<SalesPipelinePage/>}/><Route path="/advertising" element={<AdsManagerPage/>}/><Route path="/attribution" element={<AttributionPage/>}/><Route path="/analytics" element={<AnalyticsWorkspace/>}/><Route path="/integrations" element={<IntegrationManager/>}/><Route path="/journal" element={<JournalPage/>}/><Route path="/sync-journal" element={<JournalPage/>}/><Route path="/architecture" element={<MarketingArchitecturePage/>}/></Routes></div>
    </main>{workspace && <UserWorkspaceModal mode={workspace} onClose={() => setWorkspace(null)}/>} 
  </div>;
}

export default function MarketingPlatform() { return <BrowserRouter><Shell/></BrowserRouter>; }
