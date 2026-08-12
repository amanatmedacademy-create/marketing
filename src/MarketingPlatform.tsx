import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, BarChart3, Bot, Cable, CalendarDays, ChartNoAxesCombined, Database, FileText, Goal, LayoutDashboard, ListChecks, LockKeyhole, Menu, MessageCircle, PhoneCall, Send, Settings, Tags, TriangleAlert, UsersRound, Workflow } from 'lucide-react';
import AdsManagerPage from './components/AdsManagerPage';
import AnalyticsWorkspace from './components/AnalyticsWorkspace';
import CompanySwitcher from './components/CompanySwitcher';
import CrmWorkspace from './components/CrmWorkspace';
import DashboardCsvExport from './components/DashboardCsvExport';
import DataInspectorAutoLayer from './components/DataInspectorAutoLayer';
import DealWorkspaceHost from './components/DealWorkspace';
import { DealWorkspaceProvider } from './components/DealWorkspaceController';
import GlobalSearch from './components/GlobalSearch';
import ImdsBrand from './components/ImdsBrand';
import ThemeToggle from './components/ThemeToggle';
import { CallCenterChatPage } from './pages/CallCenterChatPage';
import { LeadsPage } from './pages/LeadsPage';
import MarketingDashboardSummary from './components/MarketingDashboardSummary';
import UserWorkspaceModal from './components/UserWorkspaceModal';
import { SalesFunnelPage } from './pages/SalesFunnelPage';
import { AuditPage } from './pages/AuditPage';
import TelephonyPage from './pages/TelephonyPage';
import ContextualSchedulePage from './pages/ContextualSchedulePage';
import MarketingOS from './pages/MarketingOS';
import { WhatsAppCampaignsPage } from './pages/MarketingSuitePages';
import { SafeDataQualityPage, SafeWhatsAppTemplatesPage } from './pages/PlatformQualitySafePages';
import Customer360Page from './pages/Customer360Page';
import GrowthEnginePage from './pages/GrowthEnginePage';
import { SafeLeadFormsPage, SafeMediaPlanPage, SafeUtmBuilderPage } from './pages/GrowthToolsSafePages';
import JourneyAutomationPage from './pages/JourneyAutomationPage';
import { MarketingAiPage } from './pages/StrategicPlatformPages';
import IntegrationsWorkspace from './pages/IntegrationsWorkspace';
import ContextualTasksPage from './pages/ContextualTasksPage';
import { useAuth } from './components/AuthGate';
import './marketing-platform.css';

type WorkspaceMode = 'profile' | 'settings' | null;
type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; moduleId: string | readonly string[]; end?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const navigation: NavGroup[] = [
  { label: 'ОБЗОР', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, moduleId: 'dashboard' },
  ]},
  { label: 'РАБОТА', items: [
    { to: '/tasks', label: 'Задачи', icon: ListChecks, moduleId: 'work.tasks' },
  ]},
  { label: 'CRM', items: [
    { to: '/crm', label: 'CRM', icon: UsersRound, moduleId: ['crm.leads', 'crm.pipeline'] },
  ]},
  { label: 'КОММУНИКАЦИИ', items: [
    { to: '/chat', label: 'Входящие', icon: MessageCircle, moduleId: 'communications.chat' },
    { to: '/telephony', label: 'Телефония', icon: PhoneCall, moduleId: 'communications.calls' },
    { to: '/schedule', label: 'Clinic Schedule', icon: CalendarDays, moduleId: 'communications.calls' },
    { to: '/whatsapp/campaigns', label: 'WhatsApp-рассылки', icon: Send, moduleId: 'communications.chat' },
    { to: '/whatsapp/templates', label: 'WhatsApp-шаблоны', icon: FileText, moduleId: 'communications.chat' },
  ]},
  { label: 'РЕКЛАМА', items: [
    { to: '/advertising', label: 'Рекламные кампании', icon: ChartNoAxesCombined, moduleId: 'advertising' },
  ]},
  { label: 'АНАЛИТИКА', items: [
    { to: '/analytics', label: 'Аналитика', icon: BarChart3, moduleId: 'analytics.reports' },
    { to: '/growth', label: 'Growth Engine', icon: Activity, moduleId: 'analytics.reports' },
    { to: '/utm-builder', label: 'UTM Builder', icon: Tags, moduleId: 'analytics.attribution' },
  ]},
  { label: 'МАРКЕТИНГ', items: [
    { to: '/marketing', label: 'Центр маркетинга', icon: Workflow, moduleId: 'dashboard' },
    { to: '/automation', label: 'Journey Automation', icon: Workflow, moduleId: 'dashboard' },
    { to: '/assistant', label: 'IMDS AI', icon: Bot, moduleId: 'analytics.reports' },
    { to: '/lead-forms', label: 'Формы захвата', icon: FileText, moduleId: 'crm.leads' },
    { to: '/media-plan', label: 'Медиаплан', icon: Goal, moduleId: 'dashboard' },
  ]},
  { label: 'ПЛАТФОРМА', items: [
    { to: '/integrations', label: 'Интеграции', icon: Cable, moduleId: 'integrations' },
    { to: '/data-quality', label: 'Качество данных', icon: Database, moduleId: 'audit' },
    { to: '/audit', label: 'Аудит и ошибки', icon: TriangleAlert, moduleId: 'audit' },
  ]},
];

function DashboardRoute() {
  return <>
    <DashboardCsvExport />
    <MarketingDashboardSummary />
  </>;
}

function Shell() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceMode>(null);
  const initials = (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const canView = (moduleId: string) => user.role === 'administrator' || Boolean(user.permissions?.[moduleId]?.view || user.permissions?.[moduleId]?.manage);
  const canViewItem = (moduleId: NavItem['moduleId']) => Array.isArray(moduleId) ? moduleId.some((id) => canView(id)) : canView(moduleId as string);
  const visibleGroups = navigation.map(group => ({ ...group, items: group.items.filter(item => canViewItem(item.moduleId)) })).filter(group => group.items.length > 0);
  const firstRoute = visibleGroups[0]?.items[0]?.to || '/';
  const guard = (moduleId: string, element: ReactNode) => canView(moduleId) ? element : <AccessDenied/>;
  const crmHome = canView('crm.leads') ? '/leads' : canView('crm.pipeline') ? '/pipeline' : firstRoute;
  const crm = (element: ReactNode) => <CrmWorkspace canView={canView}>{element}</CrmWorkspace>;
  const isCrmRoute = location.pathname === '/crm' || location.pathname === '/leads' || location.pathname === '/customers' || location.pathname.startsWith('/pipeline');

  return <div className="marketing-shell">
    <aside className={open ? 'open' : ''}>
      <div className="marketing-brand"><ImdsBrand compact /></div>
      <div className="marketing-nav-groups">{visibleGroups.map(group => <section className="marketing-nav-group" key={group.label}>
        <div className="marketing-nav-label">{group.label}</div>
        <nav>{group.items.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive || (to === '/crm' && isCrmRoute) ? 'active' : undefined} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      </section>)}</div>
    </aside>
    {open && <button className="marketing-mobile-backdrop" type="button" aria-label="Закрыть меню" onClick={() => setOpen(false)} />}
    <main>
      <header className="marketing-topbar">
        <button className="marketing-menu" type="button" aria-label="Открыть меню" aria-expanded={open} onClick={() => setOpen(!open)}><Menu size={21}/></button>
        <GlobalSearch />
        <div className="marketing-top-actions">
          <CompanySwitcher />
          <ThemeToggle />
          {user.role === 'administrator' && <button className="topbar-settings-button" type="button" aria-label="Настройки" onClick={() => setWorkspace('settings')}><Settings size={17}/></button>}
          <button className="topbar-profile-button" type="button" onClick={() => setWorkspace('profile')}><span>{initials}</span><div><strong>{user.name || 'Пользователь'}</strong><small>{user.jobTitle || (user.role === 'administrator' ? 'Полный доступ' : user.role)}</small></div></button>
        </div>
      </header>
      <div className="marketing-content"><Routes>
        <Route path="/" element={guard('dashboard', <DashboardRoute/>)} />
        <Route path="/goals" element={<Navigate to="/" replace/>} />
        <Route path="/tasks" element={guard('work.tasks', <ContextualTasksPage/>)} />
        <Route path="/chat" element={guard('communications.chat', <CallCenterChatPage/>)} />
        <Route path="/crm" element={<Navigate to={crmHome} replace/>} />
        <Route path="/leads" element={guard('crm.leads', crm(<LeadsPage/>))} />
        <Route path="/customers" element={guard('crm.leads', crm(<Customer360Page/>))} />
        <Route path="/telephony" element={guard('communications.calls', <TelephonyPage/>)} />
        <Route path="/phone" element={<Navigate to="/telephony" replace/>} />
        <Route path="/calls" element={<Navigate to="/telephony" replace/>} />
        <Route path="/schedule" element={guard('communications.calls', <ContextualSchedulePage/>)} />
        <Route path="/pipeline/*" element={guard('crm.pipeline', crm(<SalesFunnelPage/>))} />
        <Route path="/whatsapp/campaigns" element={guard('communications.chat', <WhatsAppCampaignsPage/>)} />
        <Route path="/whatsapp/templates" element={guard('communications.chat', <SafeWhatsAppTemplatesPage/>)} />
        <Route path="/advertising" element={guard('advertising', <AdsManagerPage/>)} />
        <Route path="/segments" element={<Navigate to="/leads" replace/>} />
        <Route path="/attribution" element={<Navigate to="/analytics" replace/>} />
        <Route path="/utm-builder" element={guard('analytics.attribution', <SafeUtmBuilderPage/>)} />
        <Route path="/analytics" element={guard('analytics.reports', <AnalyticsWorkspace/>)} />
        <Route path="/growth" element={guard('analytics.reports', <GrowthEnginePage/>)} />
        <Route path="/reports" element={<Navigate to="/" replace/>} />
        <Route path="/marketing" element={guard('dashboard', <MarketingOS/>)} />
        <Route path="/automation" element={guard('dashboard', <JourneyAutomationPage/>)} />
        <Route path="/assistant" element={guard('analytics.reports', <MarketingAiPage/>)} />
        <Route path="/lead-forms" element={guard('crm.leads', <SafeLeadFormsPage/>)} />
        <Route path="/media-plan" element={guard('dashboard', <SafeMediaPlanPage/>)} />
        <Route path="/integrations" element={guard('integrations', <IntegrationsWorkspace/>)} />
        <Route path="/google" element={<Navigate to="/integrations" replace/>} />
        <Route path="/data-quality" element={guard('audit', <SafeDataQualityPage/>)} />
        <Route path="/notifications" element={<Navigate to="/integrations" replace/>} />
        <Route path="/audit" element={guard('audit', <AuditPage/>)} />
        <Route path="/architecture" element={<Navigate to="/integrations" replace/>} />
        <Route path="*" element={<Navigate to={firstRoute} replace/>} />
      </Routes>{user.role === 'administrator' && <DataInspectorAutoLayer/>}</div>
    </main>
    <DealWorkspaceHost/>
    {workspace && <UserWorkspaceModal mode={workspace} onClose={() => setWorkspace(null)}/>} 
  </div>;
}

function AccessDenied() {
  return <div className="module-access-denied"><LockKeyhole size={32}/><h2>Нет доступа к модулю</h2><p>Обратитесь к администратору, чтобы изменить должность или персональные права.</p></div>;
}

export default function MarketingPlatform() {
  return <BrowserRouter><DealWorkspaceProvider><Shell/></DealWorkspaceProvider></BrowserRouter>;
}
