import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { BarChart3, Bell, Cable, ChartNoAxesCombined, LayoutDashboard, LockKeyhole, Menu, MessageCircle, PhoneCall, Search, Settings, Tags, TriangleAlert, UsersRound, Workflow } from 'lucide-react';
import AdsManagerPage from './components/AdsManagerPage';
import AnalyticsWorkspace from './components/AnalyticsWorkspace';
import ImdsBrand from './components/ImdsBrand';
import IntegrationManager from './components/IntegrationManager';
import { CallCenterChatPage } from './pages/CallCenterChatPage';
import { LeadsPage } from './pages/LeadsPage';
import MarketingDashboardSummary from './components/MarketingDashboardSummary';
import UserWorkspaceModal from './components/UserWorkspaceModal';
import { AttributionPage, MarketingArchitecturePage } from './components/MarketingModules';
import { SalesFunnelPage } from './pages/SalesFunnelPage';
import { AuditPage } from './pages/AuditPage';
import Calls from './pages/Calls';
import { useAuth } from './components/AuthGate';
import './marketing-platform.css';

type WorkspaceMode = 'profile' | 'settings' | null;
const nav = [
  { to: '/', label: 'Dashboard Marketing', icon: LayoutDashboard, end: true, moduleId: 'dashboard' },
  { to: '/chat', label: 'Чат', icon: MessageCircle, moduleId: 'communications.chat' },
  { to: '/leads', label: 'Лиды', icon: UsersRound, moduleId: 'crm.leads' },
  { to: '/calls', label: 'Звонки', icon: PhoneCall, moduleId: 'communications.calls' },
  { to: '/pipeline', label: 'Воронка продаж', icon: Workflow, moduleId: 'crm.pipeline' },
  { to: '/advertising', label: 'Реклама', icon: ChartNoAxesCombined, moduleId: 'advertising' },
  { to: '/attribution', label: 'UTM и атрибуция', icon: Tags, moduleId: 'analytics.attribution' },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3, moduleId: 'analytics.reports' },
  { to: '/integrations', label: 'Интеграции', icon: Cable, moduleId: 'integrations' },
  { to: '/audit', label: 'Аудит и ошибки', icon: TriangleAlert, moduleId: 'audit' },
  { to: '/architecture', label: 'Архитектура', icon: Workflow, moduleId: 'platform.architecture' },
];

function Shell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceMode>(null);
  const initials = (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const canView = (moduleId: string) => user.role === 'administrator' || Boolean(user.permissions?.[moduleId]?.view || user.permissions?.[moduleId]?.manage);
  const visibleNav = nav.filter((item) => canView(item.moduleId));
  const guard = (moduleId: string, element: ReactNode) => canView(moduleId) ? element : <AccessDenied/>;

  return <div className="marketing-shell">
    <aside className={open ? 'open' : ''}>
      <div className="marketing-brand"><ImdsBrand compact /></div>
      <div className="marketing-nav-label">МАРКЕТИНГ</div>
      <nav>{visibleNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
    </aside>
    <main>
      <header className="marketing-topbar">
        <button className="marketing-menu" type="button" onClick={() => setOpen(!open)}><Menu size={21}/></button>
        <div className="marketing-search"><Search size={17}/><input placeholder="Поиск лидов, кампаний, каналов и UTM"/></div>
        <div className="marketing-top-actions">
          <button type="button" aria-label="Уведомления" onClick={() => setWorkspace('profile')}><Bell size={18}/></button>
          {user.role === 'administrator' && <button className="topbar-settings-button" type="button" aria-label="Настройки" onClick={() => setWorkspace('settings')}><Settings size={17}/></button>}
          <button className="topbar-profile-button" type="button" onClick={() => setWorkspace('profile')}><span>{initials}</span><div><strong>{user.name || 'Пользователь'}</strong><small>{user.jobTitle || (user.role === 'administrator' ? 'Полный доступ' : user.role)}</small></div></button>
        </div>
      </header>
      <div className="marketing-content"><Routes>
        <Route path="/" element={guard('dashboard', <MarketingDashboardSummary/>)} />
        <Route path="/chat" element={guard('communications.chat', <CallCenterChatPage/>)} />
        <Route path="/leads" element={guard('crm.leads', <LeadsPage/>)} />
        <Route path="/calls" element={guard('communications.calls', <Calls/>)} />
        <Route path="/pipeline/*" element={guard('crm.pipeline', <SalesFunnelPage/>)} />
        <Route path="/advertising" element={guard('advertising', <AdsManagerPage/>)} />
        <Route path="/attribution" element={guard('analytics.attribution', <AttributionPage/>)} />
        <Route path="/analytics" element={guard('analytics.reports', <AnalyticsWorkspace/>)} />
        <Route path="/integrations" element={guard('integrations', <IntegrationManager/>)} />
        <Route path="/audit" element={guard('audit', <AuditPage/>)} />
        <Route path="/architecture" element={guard('platform.architecture', <MarketingArchitecturePage/>)} />
        <Route path="*" element={<Navigate to={visibleNav[0]?.to || '/'} replace/>} />
      </Routes></div>
    </main>
    {workspace && <UserWorkspaceModal mode={workspace} onClose={() => setWorkspace(null)}/>} 
  </div>;
}

function AccessDenied() {
  return <div className="module-access-denied"><LockKeyhole size={32}/><h2>Нет доступа к модулю</h2><p>Обратитесь к администратору, чтобы изменить должность или персональные права.</p></div>;
}

export default function MarketingPlatform() { return <BrowserRouter><Shell/></BrowserRouter>; }
