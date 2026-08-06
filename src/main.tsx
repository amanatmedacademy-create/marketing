import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './components/AuthGate';
import AnalyticsTableColorizer from './components/AnalyticsTableColorizer';
import MarketingPlatform from './MarketingPlatform';
import MarketingOS from './pages/MarketingOS';
import './styles.css';
import './analytics.css';
import './dashboard-theme.css';
import './auth.css';
import './auth-google-actions.css';
import './operations.css';
import './integration-catalog.css';
import './advertising-platform-cards.css';
import './v36-dashboard-advanced.css';

function Root() {
  const operatingSystem = window.location.pathname === '/operations';

  if (operatingSystem) {
    return <div className="operations-shell">
      <header className="operations-topbar">
        <a href="/">IMDS Marketing</a>
        <nav><a href="/operations" className="active">Управление маркетингом</a><a href="/integrations">Интеграции</a></nav>
      </header>
      <main className="operations-content"><MarketingOS /></main>
    </div>;
  }

  return <>
    <MarketingPlatform />
    <AnalyticsTableColorizer />
  </>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <Root />
    </AuthGate>
  </React.StrictMode>,
);
