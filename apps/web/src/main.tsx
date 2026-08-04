import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthGate } from './modules/auth/AuthGate';
import { EntitlementsProvider } from './modules/platform/EntitlementsContext';
import { ProductShellRuntime } from './modules/platform/ProductShellRuntime';
import { ActionFeedbackProvider } from './modules/system/ActionFeedback';
import { startMarketingTelemetry } from './lib/telemetry';
import './modules/auth/auth.css';
import './modules/system/action-feedback.css';
import './modules/operations/bulk-operations.css';
import './marketing-app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

startMarketingTelemetry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ActionFeedbackProvider>
          <AuthGate>
            <EntitlementsProvider>
              <ProductShellRuntime>
                <App />
              </ProductShellRuntime>
            </EntitlementsProvider>
          </AuthGate>
        </ActionFeedbackProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
