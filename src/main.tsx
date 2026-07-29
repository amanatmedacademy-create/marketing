import React from 'react';
import ReactDOM from 'react-dom/client';
import AnalyticsApp from './AnalyticsApp';
import AuthGate from './components/AuthGate';
import MetaOAuthLauncher from './components/MetaOAuthLauncher';
import MarketingOS from './pages/MarketingOS';
import './styles.css';
import './analytics.css';
import './dashboard-theme.css';
import './auth.css';
import './operations.css';

function Root() {
  const operatingSystem = window.location.pathname === '/operations';

  if (operatingSystem) {
    return <div className="operations-shell">
      <header className="operations-topbar">
        <a href="/">AMANAT MED · Аналитика</a>
        <nav><a href="/operations" className="active">Управление маркетингом</a><a href="/integrations">Интеграции</a></nav>
      </header>
      <main className="operations-content"><MarketingOS /></main>
    </div>;
  }

  return <>
    <AnalyticsApp />
    <MetaOAuthLauncher />
  </>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <Root />
    </AuthGate>
  </React.StrictMode>,
);
