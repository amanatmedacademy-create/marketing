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
  if (!isSupabaseConfigured) {
    return <main className="rebuild-fatal">
      <section className="rebuild-fatal-card">
        <span className="rebuild-status-dot" />
        <h1>Frontend не подключён к Supabase Auth</h1>
        <p>Для загрузки реальных данных добавьте переменные сборки Cloudflare:</p>
        <pre>VITE_SUPABASE_URL\nVITE_SUPABASE_ANON_KEY</pre>
        <p>Runtime secrets <code>SUPABASE_URL</code> и <code>SUPABASE_SERVICE_ROLE_KEY</code> используются Worker и не заменяют browser-переменные Vite.</p>
      </section>
    </main>;
  }

  return <AuthGate><CrmGate><RebuiltApp /></CrmGate></AuthGate>;
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
