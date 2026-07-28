export interface MarketingLead {
  id: string;
  external_id?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  source?: string | null;
  platform?: string | null;
  campaign?: string | null;
  manager?: string | null;
  stage: string;
  next_action?: string | null;
  first_message?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  lead_created_at?: string | null;
  appointment_at?: string | null;
  arrived_at?: string | null;
  sold_at?: string | null;
  is_target?: boolean;
  sale_amount?: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardDailyRow {
  date: string;
  leads: number;
  target_leads: number;
  arrived: number;
  sales: number;
  spend: number;
  revenue: number;
}

export interface SourceSummaryRow {
  source: string;
  platform: string;
  leads: number;
  target_leads: number;
  arrived: number;
  sales: number;
  spend: number;
  revenue: number;
}

export interface AdSummaryRow {
  row_key: string;
  source?: string | null;
  platform: string;
  account_id?: string | null;
  account_name?: string | null;
  campaign_id?: string | null;
  campaign_name: string;
  adset_id?: string | null;
  adset_name?: string | null;
  ad_id?: string | null;
  creative_name?: string | null;
  creative_type?: string | null;
  status?: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  target_leads: number;
  arrived: number;
  sales: number;
  revenue: number;
  date_from?: string | null;
  date_to?: string | null;
}

export interface IntegrationRun {
  id: string;
  source: string;
  status: string;
  date_from?: string | null;
  date_to?: string | null;
  fetched: number;
  written: number;
  error?: string | null;
  started_at: string;
  finished_at?: string | null;
}

export interface IntegrationStatus {
  configured: {
    supabase: boolean;
    bitrix: boolean;
    bitrixWebhook: boolean;
    meta: boolean;
    metaWebhook: boolean;
    tiktok: boolean;
    tiktokWebhook: boolean;
    n8n: boolean;
    manualSync: boolean;
  };
  runs: IntegrationRun[];
}

export type IntegrationProvider = 'bitrix' | 'meta' | 'tiktok' | 'n8n';

export interface IntegrationCredentialSummary {
  provider: IntegrationProvider;
  configured: boolean;
  status: string;
  values: Record<string, string>;
  secretFields: Record<string, boolean>;
  updatedAt: string;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
}

export interface IntegrationConfigResponse {
  providers: IntegrationCredentialSummary[];
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const adminHeaders = (adminKey: string): HeadersInit => ({ authorization: `Bearer ${adminKey}` });

export const marketingApi = {
  health: () => apiRequest<{ ok: boolean; service: string; supabaseConfigured: boolean }>('/health'),

  listLeads: (filters?: { stage?: string; source?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.stage) params.set('stage', filters.stage);
    if (filters?.source) params.set('source', filters.source);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const query = params.size ? `?${params.toString()}` : '';
    return apiRequest<MarketingLead[]>(`/leads${query}`);
  },

  createLead: (lead: Partial<MarketingLead>) =>
    apiRequest<MarketingLead[]>('/leads', {
      method: 'POST',
      body: JSON.stringify(lead),
    }),

  updateLead: (id: string, patch: Partial<MarketingLead>) =>
    apiRequest<MarketingLead[]>(`/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteLead: (id: string) =>
    apiRequest<MarketingLead[]>(`/leads/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  dashboard: (filters?: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    const query = params.size ? `?${params.toString()}` : '';
    return apiRequest<DashboardDailyRow[]>(`/dashboard${query}`);
  },

  sources: () => apiRequest<SourceSummaryRow[]>('/sources'),
  ads: () => apiRequest<AdSummaryRow[]>('/ads'),
  integrationStatus: () => apiRequest<IntegrationStatus>('/integrations/status'),
  integrationConfigs: (adminKey: string) => apiRequest<IntegrationConfigResponse>('/integrations/config', { headers: adminHeaders(adminKey) }),
  saveIntegrationConfig: (provider: IntegrationProvider, values: Record<string, string>, adminKey: string) =>
    apiRequest<{ ok: boolean; provider: IntegrationCredentialSummary }>(`/integrations/config/${provider}`, {
      method: 'PUT',
      headers: adminHeaders(adminKey),
      body: JSON.stringify(values),
    }),
  deleteIntegrationConfig: (provider: IntegrationProvider, adminKey: string) =>
    apiRequest<{ ok: boolean; provider: IntegrationProvider }>(`/integrations/config/${provider}`, {
      method: 'DELETE',
      headers: adminHeaders(adminKey),
    }),
  testIntegration: (provider: IntegrationProvider, adminKey: string) =>
    apiRequest<{ ok: boolean; message?: string; results?: unknown[] }>(`/integrations/test/${provider}`, {
      method: 'POST',
      headers: adminHeaders(adminKey),
      body: '{}',
    }),
  syncIntegrations: (source: IntegrationProvider | 'all', days: number, adminKey: string) =>
    apiRequest<{ ok: boolean; results: unknown[] }>('/integrations/sync', {
      method: 'POST',
      headers: adminHeaders(adminKey),
      body: JSON.stringify({ source, days }),
    }),
};
