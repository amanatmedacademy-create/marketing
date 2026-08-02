import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  Bell, CalendarDays, FolderKanban, Headphones, LayoutDashboard, Moon, Search,
  Settings, Sun, UsersRound, WalletCards, Workflow,
} from 'lucide-react';
import { apiFetch } from './lib/api-client';
import { useAuth } from './modules/auth/AuthContext';
import { AnalyticsDashboard } from './modules/dashboard/AnalyticsDashboard';
import { KanbanBoard } from './modules/deals/components/KanbanBoard';
import {
  useAccountingQuery,
  useTeamQuery,
} from './modules/core/useCrmModules';
import { ProjectsWorkspace, TasksWorkspace } from './modules/core/WorkManagementViews';
import {
  ChannelsView,
  channelNavigation,
  type ChannelView,
} from './modules/channels/ChannelsView';
import { useEntitlements } from './modules/platform/EntitlementsContext';

type CoreView = 'dashboard' | 'deals' | 'tasks' | 'projects' | 'team' | 'accounting';
type View = CoreView | ChannelView;
type OpenMenu = 'notifications' | 'profile' | null;
type DashboardResponse = {
  metrics: { amountInWork: number; newDeals: number; openTasks: number; unansweredConversations: number };
  stages: Array<{ id: string; name: string; position: number }>;
};

type NavigationItem = {
  id: View;
  moduleId: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const VIEW_MODULES: Record<View, string> = {
  dashboard: 'dashboard',
  deals: 'crm.deals',
  tasks: 'work.tasks',
  projects: 'work.projects',
  team: 'team',
  accounting: 'accounting',
  whatsapp: 'communications.whatsapp',
  instagram: 'communications.instagram',
  email: 'communications.email',
  ads: 'advertising',
  analytics: 'analytics.attribution',
  cloud: 'cloud',
  meetings: 'meetings',
  integrations: 'integrations',
};

const primaryNavigation: NavigationItem[] = [
  { id: 'dashboard', moduleId: VIEW_MODULES.dashboard, label: 'Дашборд', icon: LayoutDashboard },
  { id: 'deals', moduleId: VIEW_MODULES.deals, label: 'Сделки', icon: Workflow },
  { id: 'tasks', moduleId: VIEW_MODULES.tasks, label: 'Задачи', icon: CalendarDays },
  { id: 'projects', moduleId: VIEW_MODULES.projects, label: 'Проекты', icon: FolderKanban },
  { id: 'team', moduleId: VIEW_MODULES.team, label: 'Команда', icon: UsersRound },
  { id: 'accounting', moduleId: VIEW_MODULES.accounting, label: 'Бухгалтерия', icon: WalletCards },
];

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Almaty' });
const channelIds = new Set<ChannelView>(channelNavigation.map(item => item.id));
const isChannelView = (view: View): view is ChannelView => channelIds.has(view as ChannelView);

export default function App() {
  const { currentUser, initials, logout } = useAuth();
  const entitlements = useEntitlements();
  const [view, setView] = useState<View>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(new Date());
  const [bannerVisible, setBannerVisible] = useState(true);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

  const accessReady = !entitlements.loading && !entitlements.error;
  const dashboardAllowed = entitlements.hasModule(VIEW_MODULES.dashboard);
  const visiblePrimaryNavigation = accessReady
    ? primaryNavigation.filter(item => entitlements.hasModule(item.moduleId))
    : [];
  const visibleChannelNavigation = accessReady
    ? channelNavigation.filter(item => entitlements.hasModule(VIEW_MODULES[item.id]))
    : [];
  const viewAllowed = accessReady && entitlements.hasModule(VIEW_MODULES[view]);

  const openView = (candidate: View) => {
    if (!accessReady || !entitlements.hasModule(VIEW_MODULES[candidate])) return;
    setView(candidate);
  };

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const close = () => setOpenMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, []);
  useEffect(() => {
    if (!accessReady || viewAllowed) return;
    const fallback = visiblePrimaryNavigation[0]?.id ?? visibleChannelNavigation[0]?.id;
    if (fallback) setView(fallback);
  }, [accessReady, viewAllowed, visiblePrimaryNavigation, visibleChannelNavigation]);
  useEffect(() => {
    if (entitlements.loading) {
      setLoading(true);
      return;
    }
    if (entitlements.error || !dashboardAllowed) {
      setDashboard(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void apiFetch<DashboardResponse>('/dashboard')
      .then((data) => { if (active) { setDashboard(data); setError(''); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Нет соединения'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUser.companyId, entitlements.loading, entitlements.error, dashboardAllowed]);

  const metrics = useMemo(() => ({
    amountInWork: dashboard?.metrics.amountInWork ?? 0,
    newDeals: dashboard?.metrics.newDeals ?? 0,
    openTasks: dashboard?.metrics.openTasks ?? 0,
    unansweredConversations: dashboard?.metrics.unansweredConversations ?? 0,
  }), [dashboard]);

  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Almaty' }).format(now);
  const date = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' }).format(now);
  const toggleMenu = (menu: Exclude<OpenMenu, null>) => (event: MouseEvent) => { event.stopPropagation(); setOpenMenu(current => current === menu ? null : menu); };

  return <div className="satu-shell">
    <aside className="sidebar">
      <div className="brand-dot"><span /></div>
      <nav className="nav-primary">{visiblePrimaryNavigation.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} title={label} onClick={() => openView(id)}><Icon size={18} /></button>)}</nav>
      <nav className="nav-secondary">{visibleChannelNavigation.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} title={label} onClick={() => openView(id)}><Icon size={18} /></button>)}</nav>
      {entitlements.hasModule(VIEW_MODULES.integrations) && <button className="settings-button" title="Настройки" onClick={() => openView('integrations')}><Settings size={18} /></button>}
    </aside>
    <main className="main-column">
      {bannerVisible && <section className="subscription-banner"><span><strong>{currentUser.companyName}</strong>{accessReady && <small> · {entitlements.getLimit('users')} пользователей · {entitlements.getLimit('pipelines')} воронок · {entitlements.getLimit('adAccounts')} рекламных кабинетов</small>}</span><div><button className="close-banner" onClick={() => setBannerVisible(false)}>×</button></div></section>}
      <header className="topbar">
        <div className="clock-block"><strong>{time}</strong><span>{date}</span></div>
        <label className="search-box"><Search size={16} /><input placeholder="Поиск или вопрос .J.A.R.V.I.S..." /><span className="ai-badge">AI</span></label>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setDark(value => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button"><Headphones size={17} /></button>
          <div className="dropdown-wrap"><button className="icon-button notification-button" onClick={toggleMenu('notifications')}><Bell size={17} /></button>{openMenu === 'notifications' && <div className="dropdown-menu" onClick={event => event.stopPropagation()}><div className="dropdown-head">Уведомления</div><span>Новых уведомлений нет</span></div>}</div>
          <div className="dropdown-wrap">
            <button className="avatar-button" onClick={toggleMenu('profile')} aria-label={currentUser.fullName}>{currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt={currentUser.fullName} referrerPolicy="no-referrer" /> : initials}</button>
            {openMenu === 'profile' && <div className="dropdown-menu" onClick={event => event.stopPropagation()}><div className="dropdown-head"><strong>{currentUser.fullName}</strong><span>{currentUser.role.toUpperCase()}</span><small>{currentUser.email}</small><small>{currentUser.companyName}</small></div>{entitlements.hasModule(VIEW_MODULES.integrations) && <button onClick={() => openView('integrations')}>Настройки</button>}<button onClick={() => void logout()}>Выйти</button></div>}
          </div>
        </div>
      </header>
      <section className="content">
        {entitlements.loading && <div className="empty-state">Загрузка доступных модулей…</div>}
        {entitlements.error && <div className="empty-state"><strong>Не удалось загрузить права компании</strong><span>{entitlements.error}</span><button onClick={() => void entitlements.refresh()}>Повторить</button></div>}
        {viewAllowed && view === 'dashboard' && <AnalyticsDashboard userName={currentUser.firstName} metrics={metrics} stages={dashboard?.stages ?? []} loading={loading} error={error} onOpenDeals={() => openView('deals')} onOpenTasks={() => openView('tasks')} onOpenInbox={() => openView('whatsapp')} onOpenAds={() => openView('ads')} />}
        {viewAllowed && view === 'deals' && <KanbanBoard />}
        {viewAllowed && view === 'tasks' && <TasksWorkspace />}
        {viewAllowed && view === 'projects' && <ProjectsWorkspace />}
        {viewAllowed && view === 'team' && <TeamView />}
        {viewAllowed && view === 'accounting' && <AccountingView />}
        {viewAllowed && isChannelView(view) && <ChannelsView view={view} />}
      </section>
    </main>
  </div>;
}

function TeamView() {
  const query = useTeamQuery();
  const members = query.data ?? [];
  const initials = (first: string, last: string) => `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
  const activity = (value: string | null, online: boolean) => online ? 'сейчас' : value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }).format(new Date(value)) : 'нет данных';
  return <div className="view-page"><div className="view-title"><h1>Команда</h1><span>{query.isLoading ? 'Загрузка…' : `${members.length} сотрудников`}</span></div>{!query.isLoading && !members.length ? <div className="empty-state">Участников компании пока нет</div> : <div className="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Email</th><th>Роль</th><th>Статус</th><th>Активность</th></tr></thead><tbody>{members.map(member => <tr key={member.userId}><td>{member.avatarUrl ? <img className="member-avatar" src={member.avatarUrl} alt={member.fullName} referrerPolicy="no-referrer" /> : <span className="member-avatar">{initials(member.firstName, member.lastName)}</span>}{member.fullName}</td><td>{member.email}</td><td><b className="role-chip">{member.role.toUpperCase()}</b></td><td><i className={member.isOnline ? 'online' : ''} />{member.isOnline ? 'Онлайн' : 'Офлайн'}</td><td>{activity(member.lastSeenAt, member.isOnline)}</td></tr>)}</tbody></table></div>}</div>;
}

function AccountingView() {
  const query = useAccountingQuery();
  const data = query.data;
  const summary = data?.summary ?? { income: 0, expense: 0, profit: 0, vat: 0 };
  const transactions = data?.transactions ?? [];
  return <div className="view-page"><div className="view-title"><h1>Бухгалтерия</h1></div><div className="kpi-grid"><article className="kpi-card"><span>Доход</span><strong className="income">{money.format(summary.income)}</strong></article><article className="kpi-card"><span>Расход</span><strong className="expense">{money.format(summary.expense)}</strong></article><article className="kpi-card"><span>Прибыль</span><strong>{money.format(summary.profit)}</strong></article><article className="kpi-card"><span>НДС</span><strong>{money.format(summary.vat)}</strong></article></div>{transactions.length ? <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Описание</th><th>Счёт</th><th>Сумма</th></tr></thead><tbody>{transactions.map(item => <tr key={item.id}><td>{dateFormatter.format(new Date(item.occurred_at))}</td><td>{item.description}</td><td>{item.accountName}</td><td className={item.type === 'income' ? 'income' : item.type === 'expense' ? 'expense' : ''}>{item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}{money.format(item.amount)}</td></tr>)}</tbody></table></div> : <div className="empty-state">Операций пока нет</div>}</div>;
}
