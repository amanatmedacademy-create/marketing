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
import './styles.css';
import './modules.css';
import './preview-fidelity.css';
import './channel-modules.css';
import './modules/dashboard/analytics-dashboard.css';
import './modules/dashboard/analytics-data.css';
import './modules/dashboard/deals-trend-chart.css';
import './modules/inbox/omnichannel-inbox.css';
import './modules/inbox/whatsapp-workspace.css';
import './modules/inbox/social-mail-workspaces.css';
import './modules/deals/deal-details.css';
import './modules/deals/lead-modal.css';
import './modules/deals/pipeline-manager.css';
import './modules/ads/ads-workspace.css';
import './modules/ads/ads-performance-table.css';
import './modules/integrations/integrations-workspace.css';
import './modules/auth/auth.css';
import './modules/auth/user-profile.css';
import './ui-system.css';
import './modules/deals/kanban-fix.css';
import './modules/analytics/end-to-end-analytics.css';
import './modules/system/action-feedback.css';
import './modules/platform/product-shell-runtime.css';

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
