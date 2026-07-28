export interface MarketingLead {
  id: string;
  external_id?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  source?: string | null;
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
};
