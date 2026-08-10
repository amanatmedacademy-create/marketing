import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { BarChart3, Bell, Bot, Cable, ChartNoAxesCombined, Database, FileText, Goal, LayoutDashboard, Layers3, LockKeyhole, Menu, MessageCircle, PhoneCall, Send, Settings, Tags, TriangleAlert, UserRoundSearch, UsersRound, Workflow } from 'lucide-react';
import AdsManagerPage from './components/AdsManagerPage';
import AnalyticsWorkspace from './components/AnalyticsWorkspace';
import DataInspectorAutoLayer from './components/DataInspectorAutoLayer';
import DealWorkspaceHost from './components/DealWorkspace';
import { DealWorkspaceProvider } from './components/DealWorkspaceController';
import GlobalSearch from './components/GlobalSearch';
import ImdsBrand from './components/ImdsBrand';
import { CallCenterChatPage } from './pages/CallCenterChatPage';
import { LeadsPage } from './pages/LeadsPage';
import MarketingDashboardSummary from './components/MarketingDashboardSummary';
import UserWorkspaceModal from './components/UserWorkspaceModal';
import { AttributionPage, MarketingArchitecturePage } from './components/MarketingModules';
import { SalesFunnelPage } from './pages/SalesFunnelPage';
import { AuditPage } from './pages/AuditPage';
import Calls from './pages/Calls';
import MarketingOS from './pages/MarketingOS';
import { GoalsPage, NotificationsPage, SegmentsPage } from './pages/ProductModules';
import { DataQualityPage, ReportsPage, WhatsAppCampaignsPage, WhatsAppTemplatesPage } from './pages/MarketingSuitePages';
import { LeadFormsPage, MediaPlanPage, UtmBuilderPage } from './pages/GrowthToolsPages';
import { Customer360Page, JourneyAutomationPage, MarketingAiPage } from './pages/StrategicPlatformPages';
import IntegrationsWorkspace from './pages/IntegrationsWorkspace';
import { useAuth } from './components/AuthGate';
import './marketing-platform.css';

type WorkspaceMode = 'profile' | 'settings' | null;
type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; moduleId: string; end?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const navigation: NavGroup[] = [
  { label: 'ОБЗОР', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, moduleId: 'dashboard' },
    { to: '/goals', label: 'Цели и эффективность', icon: Goal, moduleId: 'dashboard' },
  ]},
  { label: 'CRM', items: [
    { to: '/leads', label: 'Лиды', icon: UsersRound, moduleId: 'crm.leads' },
    { to: '/customers', label: 'Клиенты 360°', icon: UserRoundSearch, moduleId: 'crm.leads' },
    { to: '/pipeline', label: 'Воронка продаж', icon: Workflow, moduleId: 'crm.pipeline' },
  ]},
  { label: 'КОММУНИКАЦИИ', items: [
    { to: '/chat', label: 'Входящие', icon: MessageCircle, moduleId: 'communications.chat' },
    { to: '/calls', label: 'Звонки', icon: PhoneCall, moduleId: 'communications.calls' },
    { to: '/whatsapp/campaigns', label: 'WhatsApp-рассылки', icon: Send, moduleId: 'communications.chat' },
    { to: '/whatsapp/templates', label: 'WhatsApp-шаблоны', icon: FileText, moduleId: 'communications.chat' },
  ]},
  { label: 'РЕКЛАМА', items: [
    { to: '/advertising', label: 'Рекламные кампании', icon: ChartNoAxesCombined, moduleId: 'advertising' },
    { to: '/segments', label: 'Аудитории и сегменты', icon: Layers3, moduleId: 'analytics.reports' },
  ]},
  { label: 'АНАЛИТИКА', items: [
    { to: '/analytics', label: 'Аналитика', icon: BarChart3, moduleId: 'analytics.reports' },
    { to: '/attribution', label: 'Атрибуция', icon: Tags, moduleId: 'analytics.attribution' },
    { to: '/utm-builder', label: 'UTM Builder', icon: Tags, moduleId: 'analytics.attribution' },
    { to: '/reports', label: 'Отчёты', icon: FileText, moduleId: 'analytics.reports' },
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

function Shell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceMode>(null);
  const initials = (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const canView = (moduleId: string) => user.role === 'administrator' || Boolean(user.permissions?.[moduleId]?.view || user.permissions?.[moduleId]?.manage);
  const visibleGroups = navigation.map(group => ({ ...group, items: group.items.filter(item => canView(item.moduleId)) })).filter(group => group.items.length > 0);
  const firstRoute = visibleGroups[0]?.items[0]?.to || '/';
  const guard = (moduleId: string, element: ReactNode) => canView(moduleId) ? element : <AccessDenied/>;

  return <div className="marketing-shell">
    <aside className={open ? 'open' : ''}>
      <div className="marketing-brand"><ImdsBrand compact /></div>
      <div className="marketing-nav-groups">{visibleGroups.map(group => <section className="marketing-nav-group" key={group.label}>
        <div className="marketing-nav-label">{group.label}</div>
        <nav>{group.items.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      </section>)}</div>
    </aside>
    <main>
      <header className="marketing-topbar">
        <button className="marketing-menu" type="button" onClick={() => setOpen(!open)}><Menu size={21}/></button>
        <GlobalSearch />
        <div className="marketing-top-actions">
          <button type="button" aria-label="Уведомления" onClick={() => navigate('/notifications')}><Bell size={18}/></button>
          {user.role === 'administrator' && <button className="topbar-settings-button" type="button" aria-label="Настройки" onClick={() => setWorkspace('settings')}><Settings size={17}/></button>}
          <button className="topbar-profile-button" type="button" onClick={() => setWorkspace('profile')}><span>{initials}</span><div><strong>{user.name || 'Пользователь'}</strong><small>{user.jobTitle || (user.role === 'administrator' ? 'Полный доступ' : user.role)}</small></div></button>
        </div>
      </header>
      <div className="marketing-content"><Routes>
        <Route path="/" element={guard('dashboard', <MarketingDashboardSummary/>)} />
        <Route path="/goals" element={guard('dashboard', <GoalsPage/>)} />
        <Route path="/chat" element={guard('communications.chat', <CallCenterChatPage/>)} />
        <Route path="/leads" element={guard('crm.leads', <LeadsPage/>)} />
        <Route path="/customers" element={guard('crm.leads', <Customer360Page/>)} />
        <Route path="/calls" element={guard('communications.calls', <Calls/>)} />
        <Route path="/pipeline/*" element={guard('crm.pipeline', <DealWorkspaceProvider><SalesFunnelPage/><DealWorkspaceHost/></DealWorkspaceProvider>)} />
        <Route path="/whatsapp/campaigns" element={guard('communications.chat', <WhatsAppCampaignsPage/>)} />
        <Route path="/whatsapp/templates" element={guard('communications.chat', <WhatsAppTemplatesPage/>)} />
        <Route path="/advertising" element={guard('advertising', <AdsManagerPage/>)} />
        <Route path="/segments" element={guard('analytics.reports', <SegmentsPage/>)} />
        <Route path="/attribution" element={guard('analytics.attribution', <AttributionPage/>)} />
        <Route path="/utm-builder" element={guard('analytics.attribution', <UtmBuilderPage/>)} />
        <Route path="/analytics" element={guard('analytics.reports', <AnalyticsWorkspace/>)} />
        <Route path="/reports" element={guard('analytics.reports', <ReportsPage/>)} />
        <Route path="/marketing" element={guard('dashboard', <MarketingOS/>)} />
        <Route path="/automation" element={guard('dashboard', <JourneyAutomationPage/>)} />
        <Route path="/assistant" element={guard('analytics.reports', <MarketingAiPage/>)} />
        <Route path="/lead-forms" element={guard('crm.leads', <LeadFormsPage/>)} />
        <Route path="/media-plan" element={guard('dashboard', <MediaPlanPage/>)} />
        <Route path="/integrations" element={guard('integrations', <IntegrationsWorkspace/>)} />
        <Route path="/google" element={<Navigate to="/integrations" replace/>} />
        <Route path="/data-quality" element={guard('audit', <DataQualityPage/>)} />
        <Route path="/notifications" element={guard('integrations', <NotificationsPage/>)} />
        <Route path="/audit" element={guard('audit', <AuditPage/>)} />
        <Route path="/architecture" element={guard('platform.architecture', <MarketingArchitecturePage/>)} />
        <Route path="*" element={<Navigate to={firstRoute} replace/>} />
      </Routes><DataInspectorAutoLayer/></div>
    </main>
    {workspace && <UserWorkspaceModal mode={workspace} onClose={() => setWorkspace(null)}/>} 
  </div>;
}

function AccessDenied() {
  return <div className="module-access-denied"><LockKeyhole size={32}/><h2>Нет доступа к модулю</h2><p>Обратитесь к администратору, чтобы изменить должность или персональные права.</p></div>;
}

export default function MarketingPlatform() { return <BrowserRouter><Shell/></BrowserRouter>; }
