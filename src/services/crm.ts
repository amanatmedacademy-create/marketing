import { authFetch } from './auth';

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  probability: number;
  stage_type: 'open' | 'won' | 'lost';
}

export interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  position: number;
  stages: PipelineStage[];
}

export interface Deal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  assignee_id: string | null;
  title: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  amount: number | string;
  currency: string;
  status: 'open' | 'won' | 'lost' | 'archived';
  position: number | string;
  updated_at: string;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  created_at: string;
  updated_at?: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `CRM API: ${response.status}`);
  return payload.data as T;
}

export const loadPipelines = () => api<Pipeline[]>('/api/crm/pipelines');

export const loadDeals = (pipelineId: string) =>
  api<Deal[]>(`/api/crm/deals?pipelineId=${encodeURIComponent(pipelineId)}`);

export const createDeal = (input: {
  title: string;
  stageId: string;
  phone?: string;
  email?: string;
  source?: string;
  amount?: number;
}) => api<Deal>('/api/crm/deals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(input),
});

export const moveDeal = (dealId: string, targetStageId: string) =>
  api<Deal>(`/api/crm/deals/${encodeURIComponent(dealId)}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetStageId }),
  });

export const loadContacts = (search = '') =>
  api<Contact[]>(`/api/crm/contacts${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`);

export const createContact = (input: {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  source?: string;
}) => api<Contact>('/api/crm/contacts', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(input),
});
