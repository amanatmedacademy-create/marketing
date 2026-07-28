import React from 'react';
import ReactDOM from 'react-dom/client';
import AnalyticsApp from './AnalyticsApp';
import './styles.css';
import './analytics.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AnalyticsApp />
  </React.StrictMode>,
);
