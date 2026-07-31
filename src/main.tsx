import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './components/AuthGate';
import CrmGate from './components/CrmGate';
import MetaOAuthLauncher from './components/MetaOAuthLauncher';
import AdvertisingCatalogExpansion from './components/AdvertisingCatalogExpansion';
import WabaCatalogActivation from './components/WabaCatalogActivation';
import IntegrationCatalogNormalizer from './components/IntegrationCatalogNormalizer';
import AnalyticsTableColorizer from './components/AnalyticsTableColorizer';
import ThemeToggle from './components/ThemeToggle';
import MarketingPlatform from './MarketingPlatform';
import MarketingOS from './pages/MarketingOS';
import CrmBoard from './pages/CrmBoard';
import { isSupabaseConfigured } from './services/supabase';
import './styles.css';
import './analytics.css';
import './dashboard-theme.css';
import './auth.css';
import './operations.css';
import './integration-catalog.css';
import './advertising-platform-cards.css';
import './v36-dashboard-advanced.css';
import './integration-premium-exact.css';
import './theme-toggle.css';
import './v36-light-theme.css';
import './crm.css';

function Root() {
  const pathname = window.location.pathname;
  if (pathname === '/crm') return <CrmBoard />;
  if (pathname === '/operations') {
    return <>
      <ThemeToggle />
      <div className="operations-shell">
        <header className="operations-topbar">
          <a href="/">IMDS Marketing</a>
          <nav><a href="/operations" className="active">Управление маркетингом</a><a href="/crm">CRM</a><a href="/integrations">Интеграции</a></nav>
        </header>
        <main className="operations-content"><MarketingOS /></main>
      </div>
    </>;
  }
  return <>
    <ThemeToggle />
    <MarketingPlatform />
    <AnalyticsTableColorizer />
    <MetaOAuthLauncher />
    <AdvertisingCatalogExpansion />
    <WabaCatalogActivation />
    <IntegrationCatalogNormalizer />
  </>;
}

function AppEntry() {
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';
  const crmEnabled = import.meta.env.VITE_CRM_API_ENABLED === 'true';
  const isCrmRoute = window.location.pathname === '/crm';

  let app = <Root />;
  if (crmEnabled && isCrmRoute) app = <CrmGate>{app}</CrmGate>;

  // Never mount AuthGate without a valid Supabase browser configuration.
  // Its auth subscription requires a configured client and would otherwise
  // throw during the first effect, leaving the application with a blank screen.
  if ((authEnabled || isCrmRoute) && isSupabaseConfigured) {
    app = <AuthGate>{app}</AuthGate>;
  }

  return app;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppEntry /></React.StrictMode>);
