export interface MarketingLead {
  id: string;
  external_id?: string | null;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  social_username?: string | null;
  name_locked?: boolean;
  phone: string;
  email?: string | null;
  source?: string | null;
  platform?: string | null;
  campaign?: string | null;
  manager?: string | null;
  stage: string;
  next_action?: string | null;
  first_message?: string | null;
  direction?: string | null;
  city?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  lead_created_at?: string | null;
  first_contact_at?: string | null;
  first_response_at?: string | null;
  first_response_seconds?: number | null;
  first_response_channel?: string | null;
  first_response_event_id?: string | null;
  qualified_at?: string | null;
  appointment_at?: string | null;
  arrived_at?: string | null;
  rejected_at?: string | null;
  sold_at?: string | null;
  is_target?: boolean;
  sale_amount?: number;
  created_at: string;
  updated_at: string;
}

export interface MarketingCall {
  id: string;
  external_id?: string | null;
  lead_id?: string | null;
  conversation_id?: string | null;
  deal_external_id?: string | null;
  operator_user_id?: string | null;
  operator_name?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  source?: string | null;
  channel?: string | null;
  campaign_id?: string | null;
  ad_id?: string | null;
  call_status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  started_at: string;
  scheduled_at?: string | null;
  duration_seconds: number;
  recording_url?: string | null;
  transcript?: string | null;
  summary?: string | null;
  request_reason?: string | null;
  patient_pain?: string | null;
  objections: string[];
  call_result?: string | null;
  appointment_created: boolean;
  appointment_at?: string | null;
  next_action?: string | null;
  loss_reason?: string | null;
  quality_score?: number | null;
  detected_pain?: boolean | null;
  asked_questions?: boolean | null;
  presented_value?: boolean | null;
  handled_objection?: boolean | null;
  offered_specific_time?: boolean | null;
  confirmed_appointment?: boolean | null;
  stated_next_step?: boolean | null;
  follow_up_planned?: boolean | null;
  script_violations: string[];
  ai_analysis_status?: 'idle' | 'processing' | 'completed' | 'failed';
  ai_analysis_model?: string | null;
  ai_analyzed_at?: string | null;
  ai_analysis_error?: string | null;
  ai_confidence?: number | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingCallOperatorSummary {
  operator_name: string;
  calls: number;
  pending_calls?: number;
  appointments: number;
  average_quality_score?: number | null;
  calls_without_next_action: number;
  lost_calls: number;
}

export interface DashboardDailyRow { date: string; leads: number; target_leads: number; arrived: number; sales: number; spend: number; revenue: number; }
export interface SourceSummaryRow { source: string; platform: string; leads: number; target_leads: number; arrived: number; sales: number; spend: number; revenue: number; }
export interface AdSummaryRow { row_key: string; source?: string | null; platform: string; account_id?: string | null; account_name?: string | null; campaign_id?: string | null; campaign_name: string; adset_id?: string | null; adset_name?: string | null; ad_id?: string | null; creative_name?: string | null; creative_type?: string | null; status?: string | null; impressions: number; clicks: number; spend: number; leads: number; target_leads: number; arrived: number; sales: number; revenue: number; date_from?: string | null; date_to?: string | null; }
export interface AdvertisingAccountCurrency { platform: 'Meta' | 'TikTok'; account_id: string; account_name: string | null; currency: string; }
export interface ExchangeRatesResponse { base: 'KZT'; rates: Record<string, number>; updatedAt?: string | null; }
export interface IntegrationRun { id: string; source: string; status: string; date_from?: string | null; date_to?: string | null; fetched: number; written: number; error?: string | null; started_at: string; finished_at?: string | null; }
export interface IntegrationStatus { configured: { supabase: boolean; bitrix: boolean; bitrixWebhook: boolean; meta: boolean; metaWebhook: boolean; tiktok: boolean; tiktokWebhook: boolean; n8n: boolean; manualSync: boolean; }; runs: IntegrationRun[]; }
export type IntegrationProvider = 'bitrix' | 'meta' | 'tiktok' | 'n8n';
export interface IntegrationCredentialSummary { provider: IntegrationProvider; configured: boolean; status: string; values: Record<string, string>; secretFields: Record<string, boolean>; updatedAt: string; lastVerifiedAt?: string | null; lastError?: string | null; }
export interface IntegrationConfigResponse { providers: IntegrationCredentialSummary[]; }
export interface IntegrationDisconnectResponse { ok: boolean; provider: IntegrationProvider; mode: 'archived' | 'purged'; data?: unknown; }
export interface MetaCatalogAccount { id: string; accountId: string; name: string; status: string; currency?: string | null; timezone?: string | null; creativeCount: number; selected: boolean; }
export interface MetaCatalogCreative { id: string; accountId: string; name: string; status: string; creativeId?: string | null; creativeName?: string | null; thumbnailUrl?: string | null; selected: boolean; }
export interface MetaCatalogResponse { accounts: MetaCatalogAccount[]; creatives: MetaCatalogCreative[]; selectedAccountIds: string[]; selectedAdIds: string[]; creativeSelectionMode: 'selected' | 'all'; }
export interface MetaBackfillResponse { ok: boolean; source: 'meta'; from: string; to: string; days: number; accounts: number; creativeSelectionMode: 'selected' | 'all'; selectedCreatives: number; fetched: number; written: number; }

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error((await response.text()) || `API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export const marketingApi = {
  health: () => apiRequest<{ ok: boolean; service: string; supabaseConfigured: boolean }>('/health'),
  listLeads: (filters?: { stage?: string; source?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.stage) params.set('stage', filters.stage);
    if (filters?.source) params.set('source', filters.source);
    if (filters?.limit) params.set('limit', String(filters.limit));
    return apiRequest<MarketingLead[]>(`/leads${params.size ? `?${params}` : ''}`);
  },
  createLead: (lead: Partial<MarketingLead>) => apiRequest<MarketingLead[]>('/leads', { method: 'POST', body: JSON.stringify(lead) }),
  updateLead: (id: string, patch: Partial<MarketingLead>) => apiRequest<MarketingLead[]>(`/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteLead: (id: string) => apiRequest<MarketingLead[]>(`/leads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  calls: (filters?: { operator?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.operator) params.set('operator', filters.operator);
    if (filters?.limit) params.set('limit', String(filters.limit));
    return apiRequest<MarketingCall[]>(`/calls${params.size ? `?${params}` : ''}`);
  },
  callOperators: () => apiRequest<MarketingCallOperatorSummary[]>('/calls/operators'),
  dashboard: (filters?: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    return apiRequest<DashboardDailyRow[]>(`/dashboard${params.size ? `?${params}` : ''}`);
  },
  sources: () => apiRequest<SourceSummaryRow[]>('/sources'),
  ads: () => apiRequest<AdSummaryRow[]>('/ads'),
  adCurrencies: () => apiRequest<{ accounts: AdvertisingAccountCurrency[] }>('/ads/currencies'),
  exchangeRates: () => apiRequest<ExchangeRatesResponse>('/exchange-rates'),
  integrationStatus: () => apiRequest<IntegrationStatus>('/integrations/status'),
  integrationConfigs: () => apiRequest<IntegrationConfigResponse>('/integrations/config'),
  saveIntegrationConfig: (provider: IntegrationProvider, values: Record<string, string>) => apiRequest<{ ok: boolean; provider: IntegrationCredentialSummary }>(`/integrations/config/${provider}`, { method: 'PUT', body: JSON.stringify(values) }),
  deleteIntegrationConfig: (provider: IntegrationProvider, purge = false) => apiRequest<IntegrationDisconnectResponse>(`/integrations/config/${provider}${purge ? '?purge=true' : ''}`, { method: 'DELETE' }),
  testIntegration: (provider: IntegrationProvider) => apiRequest<{ ok: boolean; message?: string; results?: unknown[] }>(`/integrations/test/${provider}`, { method: 'POST', body: '{}' }),
  syncIntegrations: (source: IntegrationProvider | 'all', days: number) => apiRequest<{ ok: boolean; results: unknown[] }>('/integrations/sync', { method: 'POST', body: JSON.stringify({ source, days }) }),
  metaCatalog: (accountIds: string[] = []) => {
    const params = new URLSearchParams();
    if (accountIds.length) params.set('account_ids', accountIds.join(','));
    return apiRequest<MetaCatalogResponse>(`/integrations/meta/catalog${params.size ? `?${params}` : ''}`);
  },
  saveMetaSelection: (selectedAdIds: string[], options?: { prune?: boolean; verified?: boolean }) => apiRequest<{ ok: boolean; selectedAccountIds: string[]; selectedAdIds: string[]; creativeSelectionMode: 'selected' | 'all'; verified: boolean }>('/integrations/meta/selection', {
    method: 'POST',
    body: JSON.stringify({ selectedAdIds, prune: options?.prune ?? true, verified: options?.verified ?? false }),
  }),
  metaBackfill: (days: number) => apiRequest<MetaBackfillResponse>('/integrations/meta/backfill', { method: 'POST', body: JSON.stringify({ days }) }),
};