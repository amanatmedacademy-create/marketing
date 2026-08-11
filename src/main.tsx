import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './components/AuthGate';
import MarketingPlatform from './MarketingPlatform';
import './styles.css';
import './analytics.css';
import './dashboard-theme.css';
import './auth.css';
import './operations.css';
import './integration-catalog.css';
import './advertising-platform-cards.css';
import './v36-dashboard-advanced.css';
import './user-admin.css';
import './call-center-chat-layout-fix.css';
import './sales-funnel-fullheight.css';
import './clinic-schedule-mis-parity.css';
import './imds-redesign.css';
import './dashboard-redesign.css';
import './imds-modules-redesign.css';
import './imds-strict-theme.css';
import './imds-screen-normalization.css';
import './imds-chart-normalization.css';
import './imds-exact-background.css';

function Root() {
  if (window.location.pathname === '/operations') {
    window.history.replaceState({}, document.title, '/marketing');
  }

  return <MarketingPlatform />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <Root />
    </AuthGate>
  </React.StrictMode>,
);
