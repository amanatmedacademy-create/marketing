import { useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { BarChart3, Bell, Cable, ChartNoAxesCombined, LayoutDashboard, Menu, MessageCircle, MessageSquareText, PhoneCall, Search, Settings, Tags, TriangleAlert, UsersRound, Workflow } from 'lucide-react';
import AdsManagerPage from './components/AdsManagerPage';
import AnalyticsWorkspace from './components/AnalyticsWorkspace';
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
  { to: '/', label: 'Dashboard Marketing', icon: LayoutDashboard, end: true },
  { to: '/chat', label: 'Чат', icon: MessageCircle },
  { to: '/leads', label: 'Лиды', icon: UsersRound },
  { to: '/calls', label: 'Звонки', icon: PhoneCall },
  { to: '/pipeline', label: 'Воронка продаж', icon: Workflow },
  { to: '/advertising', label: 'Реклама', icon: ChartNoAxesCombined },
  { to: '/attribution', label: 'UTM и атрибуция', icon: Tags },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { to: '/integrations', label: 'Интеграции', icon: Cable },
  { to: '/audit', label: 'Аудит и ошибки', icon: TriangleAlert },
  { to: '/architecture', label: 'Архитектура', icon: Workflow },
];

function Shell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceMode>(null);
  const initials = (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  return <div className="marketing-shell">
    <aside className={open ? 'open' : ''}>
      <div className="marketing-brand"><MessageSquareText/><div><b>IMDS</b><span>Marketing</span></div></div>
      <div className="marketing-nav-label">МАРКЕТИНГ</div>
      <nav>{nav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
    </aside>
    <main>
      <header className="marketing-topbar">
        <button className="marketing-menu" type="button" onClick={() => setOpen(!open)}><Menu size={21}/></button>
        <div className="marketing-search"><Search size={17}/><input placeholder="Поиск лидов, кампаний, каналов и UTM"/></div>
        <div className="marketing-top-actions">
          <button type="button" aria-label="Уведомления" onClick={() => setWorkspace('profile')}><Bell size={18}/></button>
          {user.role === 'administrator' && <button className="topbar-settings-button" type="button" aria-label="Настройки" onClick={() => setWorkspace('settings')}><Settings size={17}/></button>}
          <button className="topbar-profile-button" type="button" onClick={() => setWorkspace('profile')}><span>{initials}</span><div><strong>{user.name || 'Администратор'}</strong><small>{user.role === 'administrator' ? 'Полный доступ' : user.role}</small></div></button>
        </div>
      </header>
      <div className="marketing-content">
        <Routes>
          <Route path="/" element={<MarketingDashboardSummary/>}/>
          <Route path="/chat" element={<CallCenterChatPage/>}/>
          <Route path="/leads" element={<LeadsPage/>}/>
          <Route path="/calls" element={<Calls/>}/>
          <Route path="/pipeline" element={<SalesFunnelPage/>}/>
          <Route path="/advertising" element={<AdsManagerPage/>}/>
          <Route path="/attribution" element={<AttributionPage/>}/>
          <Route path="/analytics" element={<AnalyticsWorkspace/>}/>
          <Route path="/integrations" element={<IntegrationManager/>}/>
          <Route path="/audit" element={<AuditPage/>}/>
          <Route path="/architecture" element={<MarketingArchitecturePage/>}/>
        </Routes>
      </div>
    </main>
    {workspace && <UserWorkspaceModal mode={workspace} onClose={() => setWorkspace(null)}/>} 
  </div>;
}

export default function MarketingPlatform() {
  return <BrowserRouter><Shell/></BrowserRouter>;
}
