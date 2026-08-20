import { useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, Bot, Cable, CalendarDays, CreditCard, Database, FileText, LayoutDashboard, ListChecks, LockKeyhole, Menu, MessageCircle, PhoneCall, Send, Settings, TriangleAlert, UsersRound, Workflow } from 'lucide-react';
import CompanySwitcher from './components/CompanySwitcher';
import CrmWorkspace from './components/CrmWorkspace';
import DashboardCsvExport from './components/DashboardCsvExport';
import DataInspectorAutoLayer from './components/DataInspectorAutoLayer';
import DealWorkspaceHost from './components/DealWorkspace';
import { DealWorkspaceProvider } from './components/DealWorkspaceController';
import GlobalSearch from './components/GlobalSearch';
import ImdsBrand from './components/ImdsBrand';
import OperatingOverviewPanel from './components/OperatingOverviewPanel';
import ThemeToggle from './components/ThemeToggle';
import BillingCenterPanel from './components/BillingCenterPanel';
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
import MarketingAiPage from './pages/MarketingAiPage';
import IntegrationsWorkspace from './pages/IntegrationsWorkspace';
import ContextualTasksPage from './pages/ContextualTasksPage';
import { useAuth } from './components/AuthGate';
import { usePlatformContext } from './platform/PlatformContext';
import './marketing-platform.css';

type WorkspaceMode = 'profile' | 'settings' | null;
type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; moduleId: string | readonly string[]; platformModule?: string | readonly string[]; end?: boolean; ownerOnly?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const navigation: NavGroup[] = [
  { label: 'ОБЗОР', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, moduleId: 'dashboard' },
  ]},
  { label: 'РАБОТА', items: [
    { to: '/tasks', label: 'Задачи', icon: ListChecks, moduleId: 'work.tasks', platformModule: 'marketing.tasks' },
  ]},
  { label: 'CRM', items: [
    { to: '/crm', label: 'CRM', icon: UsersRound, moduleId: ['crm.leads', 'crm.pipeline'], platformModule: 'marketing.crm' },
  ]},
  { label: 'КОММУНИКАЦИИ', items: [
    { to: '/chat', label: 'Входящие', icon: MessageCircle, moduleId: 'communications.chat', platformModule: 'marketing.call-center' },
    { to: '/telephony', label: 'Телефония', icon: PhoneCall, moduleId: 'communications.calls', platformModule: 'marketing.call-center' },
    { to: '/schedule', label: 'Расписание', icon: CalendarDays, moduleId: 'communications.calls', platformModule: 'marketing.call-center' },
    { to: '/whatsapp/campaigns', label: 'WhatsApp-рассылки', icon: Send, moduleId: 'communications.chat', platformModule: 'marketing.whatsapp-business' },
    { to: '/whatsapp/templates', label: 'WhatsApp-шаблоны', icon: FileText, moduleId: 'communications.chat', platformModule: 'marketing.whatsapp-business' },
  ]},
  { label: 'МАРКЕТИНГ', items: [
    { to: '/marketing', label: 'Центр маркетинга', icon: Workflow, moduleId: ['dashboard', 'advertising', 'analytics.attribution', 'analytics.reports', 'crm.leads'], platformModule: ['marketing.meta-ads','marketing.automation','marketing.analytics','marketing.crm'] },
  ]},
  { label: 'АНАЛИТИКА', items: [
    { to: '/growth', label: 'Growth Engine', icon: Activity, moduleId: 'analytics.reports', platformModule: 'marketing.analytics' },
    { to: '/assistant', label: 'IMDS Intelligence', icon: Bot, moduleId: 'analytics.reports', platformModule: 'marketing.ai' },
  ]},
  { label: 'ПЛАТФОРМА', items: [
    { to: '/billing', label: 'Тариф и оплата', icon: CreditCard, moduleId: 'dashboard', ownerOnly: true },
    { to: '/integrations', label: 'Интеграции', icon: Cable, moduleId: 'integrations' },
    { to: '/data-quality', label: 'Качество данных', icon: Database, moduleId: 'audit' },
    { to: '/audit', label: 'Аудит и ошибки', icon: TriangleAlert, moduleId: 'audit' },
  ]},
];

function DashboardRoute() {
  return <>
    <OperatingOverviewPanel />
    <DashboardCsvExport />
    <MarketingDashboardSummary />
  </>;
}

function Shell() {
  const { user } = useAuth();
  const { context, platform, source, canonicalError } = usePlatformContext();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceMode>(null);
  const initials = (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const currentCompany = user.companies?.find((company) => company.id === user.companyId) || user.companies?.[0];
  const canManageBilling = user.platformRole === 'super_admin' || ['owner', 'administrator'].includes(currentCompany?.role || user.role || '');

  const localCanView = (moduleId: string) => user.role === 'administrator' || Boolean(context?.permissions.includes(moduleId) || user.permissions?.[moduleId]?.view || user.permissions?.[moduleId]?.manage);
  const marketingEnabled = context ? context.entitlements.includes('product.marketing') : true;
  const platformAllows = (moduleId?: string | readonly string[]) => {
    if (!context) return true;
    if (source === 'legacy' && (!platform || !platform.managed)) return true;
    if (!marketingEnabled) return false;
    if (!moduleId) return true;
    return Array.isArray(moduleId)
      ? moduleId.some((id) => context.entitlements.includes(id))
      : context.entitlements.includes(moduleId as string);
  };
  const canViewItem = (item: NavItem) => {
    if (item.ownerOnly) return canManageBilling;
    const local = Array.isArray(item.moduleId) ? item.moduleId.some((id) => localCanView(id)) : localCanView(item.moduleId as string);
    return local && platformAllows(item.platformModule);
  };
  const visibleGroups = navigation.map(group => ({ ...group, items: group.items.filter(canViewItem) })).filter(group => group.items.length > 0);
  const firstRoute = visibleGroups[0]?.items[0]?.to || '/';
  const platformManaged = source === 'canonical' || Boolean(platform?.managed);
  const guard = (moduleId: string, element: ReactNode, platformModule?: string | readonly string[]) => localCanView(moduleId) && platformAllows(platformModule) ? element : <AccessDenied platformControlled={Boolean(platformManaged && platformModule && !platformAllows(platformModule))}/>;
  const guardAny = (moduleIds: string[], element: ReactNode, platformModules?: string | readonly string[]) => moduleIds.some(localCanView) && platformAllows(platformModules) ? element : <AccessDenied platformControlled={Boolean(platformManaged && platformModules && !platformAllows(platformModules))}/>;
  const crmHome = localCanView('crm.leads') && platformAllows('marketing.crm') ? '/leads' : localCanView('crm.pipeline') && platformAllows('marketing.crm') ? '/pipeline' : firstRoute;
  const crm = (element: ReactNode) => <CrmWorkspace canView={localCanView}>{element}</CrmWorkspace>;
  const isCrmRoute = location.pathname === '/crm' || location.pathname === '/leads' || location.pathname === '/customers' || location.pathname.startsWith('/pipeline');
  const isMarketingRoute = location.pathname === '/marketing' || location.pathname === '/analytics' || ['/advertising','/automation','/lead-forms','/media-plan','/utm-builder','/attribution'].includes(location.pathname);
  const productSuspended = source === 'canonical' ? Boolean(context && !marketingEnabled) : Boolean(platform?.managed && !platform.productEnabled);

  if (productSuspended && location.pathname !== '/billing') {
    return <div className="module-access-denied"><LockKeyhole size={36}/><h2>IMDS Marketing приостановлен</h2><p>Рабочие модули временно недоступны. Данные сохранены.</p>{canManageBilling && <NavLink to="/billing">Открыть «Тариф и оплата»</NavLink>}</div>;
  }

  return <div className="marketing-shell">
    <aside className={open ? 'open' : ''}>
      <div className="marketing-brand"><ImdsBrand compact /></div>
      <div className="marketing-nav-groups">{visibleGroups.map(group => <section className="marketing-nav-group" key={group.label}>
        <div className="marketing-nav-label">{group.label}</div>
        <nav>{group.items.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive || (to === '/crm' && isCrmRoute) || (to === '/marketing' && isMarketingRoute) ? 'active' : undefined} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      </section>)}</div>
    </aside>
    {open && <button className="marketing-mobile-backdrop" type="button" aria-label="Закрыть меню" onClick={() => setOpen(false)} />}
    <main>
      <header className="marketing-topbar">
        <button className="marketing-menu" type="button" aria-label="Открыть меню" aria-expanded={open} onClick={() => setOpen(!open)}><Menu size={21}/></button>
        <GlobalSearch />
        <div className="marketing-top-actions">
          {platform?.managed && <span className="platform-sync-indicator" title={`Control Plane revision ${platform.revision ?? '—'}`}>SYNC {platform.revision ?? '—'}</span>}
          {canonicalError && <span className="platform-sync-indicator platform-sync-indicator--error" title={canonicalError}>PLATFORM FALLBACK</span>}
          <CompanySwitcher />
          <ThemeToggle />
          {user.role === 'administrator' && <button className="topbar-settings-button" type="button" aria-label="Настройки" onClick={() => setWorkspace('settings')}><Settings size={17}/></button>}
          <button className="topbar-profile-button" type="button" onClick={() => setWorkspace('profile')}><span>{initials}</span><div><strong>{user.name || 'Пользователь'}</strong><small>{user.jobTitle || (user.role === 'administrator' ? 'Полный доступ' : user.role)}</small></div></button>
        </div>
      </header>
      <div className="marketing-content"><Routes>
        <Route path="/" element={guard('dashboard', <DashboardRoute/>)} />
        <Route path="/goals" element={<Navigate to="/" replace/>} />
        <Route path="/tasks" element={guard('work.tasks', <ContextualTasksPage/>, 'marketing.tasks')} />
        <Route path="/chat" element={guard('communications.chat', <CallCenterChatPage/>, 'marketing.call-center')} />
        <Route path="/crm" element={<Navigate to={crmHome} replace/>} />
        <Route path="/leads" element={guard('crm.leads', crm(<LeadsPage/>), 'marketing.crm')} />
        <Route path="/customers" element={guard('crm.leads', crm(<Customer360Page/>), 'marketing.crm')} />
        <Route path="/telephony" element={guard('communications.calls', <TelephonyPage/>, 'marketing.call-center')} />
        <Route path="/phone" element={<Navigate to="/telephony" replace/>} />
        <Route path="/calls" element={<Navigate to="/telephony" replace/>} />
        <Route path="/schedule" element={guard('communications.calls', <ContextualSchedulePage/>, 'marketing.call-center')} />
        <Route path="/pipeline/*" element={guard('crm.pipeline', crm(<SalesFunnelPage/>), 'marketing.crm')} />
        <Route path="/whatsapp/campaigns" element={guard('communications.chat', <WhatsAppCampaignsPage/>, 'marketing.whatsapp-business')} />
        <Route path="/whatsapp/templates" element={guard('communications.chat', <SafeWhatsAppTemplatesPage/>, 'marketing.whatsapp-business')} />
        <Route path="/marketing" element={guardAny(['dashboard','advertising','analytics.attribution','analytics.reports','crm.leads'], <MarketingOS platform={platform}/>, ['marketing.meta-ads','marketing.automation','marketing.analytics','marketing.crm'])} />
        <Route path="/advertising" element={platformAllows('marketing.meta-ads') ? <Navigate to="/marketing?view=ads" replace/> : <AccessDenied platformControlled/>} />
        <Route path="/automation" element={platformAllows('marketing.automation') ? <Navigate to="/marketing?view=automation" replace/> : <AccessDenied platformControlled/>} />
        <Route path="/lead-forms" element={platformAllows('marketing.crm') ? <Navigate to="/marketing?view=leads" replace/> : <AccessDenied platformControlled/>} />
        <Route path="/media-plan" element={<Navigate to="/marketing?view=media-plan" replace/>} />
        <Route path="/utm-builder" element={platformAllows('marketing.analytics') ? <Navigate to="/marketing?view=attribution" replace/> : <AccessDenied platformControlled/>} />
        <Route path="/attribution" element={platformAllows('marketing.analytics') ? <Navigate to="/marketing?view=attribution" replace/> : <AccessDenied platformControlled/>} />
        <Route path="/segments" element={<Navigate to="/leads" replace/>} />
        <Route path="/analytics" element={localCanView('analytics.reports') && platformAllows('marketing.analytics') ? <Navigate to="/marketing?view=analytics" replace/> : <AccessDenied platformControlled={Boolean(platformManaged && !platformAllows('marketing.analytics'))}/>} />
        <Route path="/growth" element={guard('analytics.reports', <GrowthEnginePage/>, 'marketing.analytics')} />
        <Route path="/reports" element={<Navigate to="/" replace/>} />
        <Route path="/assistant" element={guard('analytics.reports', <MarketingAiPage/>, 'marketing.ai')} />
        <Route path="/billing" element={canManageBilling ? <BillingCenterPanel/> : <AccessDenied/>} />
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
    {workspace && <UserWorkspaceModal mode={workspace} onClose={() => setWorkspace(null)} />}
  </div>;
}

function AccessDenied({ platformControlled = false }: { platformControlled?: boolean }) {
  return <div className="module-access-denied"><LockKeyhole size={32}/><h2>Нет доступа к модулю</h2><p>{platformControlled ? 'Модуль отключён для этой организации в IMDS Control Center.' : 'Обратитесь к администратору, чтобы изменить должность или персональные права.'}</p></div>;
}

export default function MarketingPlatform() {
  return <BrowserRouter><DealWorkspaceProvider><Shell/></DealWorkspaceProvider></BrowserRouter>;
}
