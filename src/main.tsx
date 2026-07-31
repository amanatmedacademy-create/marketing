import React from 'react';
import ReactDOM from 'react-dom/client';
import RebuiltApp from './rebuild/RebuiltApp';
import AppErrorBoundary from './rebuild/AppErrorBoundary';
import './rebuild/rebuild.css';

const root = document.getElementById('root');

if (!root) {
  document.body.innerHTML = '<main style="padding:32px;font-family:system-ui">Не найден контейнер приложения #root</main>';
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <RebuiltApp />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
