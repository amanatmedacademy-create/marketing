import React from 'react';
import ReactDOM from 'react-dom/client';
import AdPreviewEnhancer from './components/AdPreviewEnhancer';
import AuthGate from './components/AuthGate';
import DealWorkspaceHost from './components/DealWorkspace';
import InternalCommunicationBridge from './components/InternalCommunicationBridge';
import VoiceTranscriptionEnhancer from './components/VoiceTranscriptionEnhancer';
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

function Root() {
  if (window.location.pathname === '/operations') {
    window.history.replaceState({}, document.title, '/marketing');
  }

  return <>
    <MarketingPlatform />
    <AdPreviewEnhancer />
    <DealWorkspaceHost />
    <InternalCommunicationBridge />
    <VoiceTranscriptionEnhancer />
  </>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <Root />
    </AuthGate>
  </React.StrictMode>,
);