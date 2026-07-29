import React from 'react';
import ReactDOM from 'react-dom/client';
import AnalyticsApp from './AnalyticsApp';
import AuthGate from './components/AuthGate';
import './styles.css';
import './analytics.css';
import './auth.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <AnalyticsApp />
    </AuthGate>
  </React.StrictMode>,
);