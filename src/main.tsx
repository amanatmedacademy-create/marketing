import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './components/AuthGate';
import CrmGate from './components/CrmGate';
import RebuiltApp from './rebuild/RebuiltApp';
import AppErrorBoundary from './rebuild/AppErrorBoundary';
import { isSupabaseConfigured } from './services/supabase';
import './styles.css';
import './rebuild/rebuild.css';
import './crm.css';
import './contacts.css';

const root = document.getElementById('root');

function AppEntry() {
  const app = <CrmGate><RebuiltApp /></CrmGate>;
  return isSupabaseConfigured ? <AuthGate>{app}</AuthGate> : app;
}

if (!root) {
  document.body.innerHTML = '<main style="padding:32px;font-family:system-ui">Не найден контейнер приложения #root</main>';
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <AppEntry />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
