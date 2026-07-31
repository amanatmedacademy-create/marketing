import { authFetch } from './auth';

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  role: 'owner' | 'administrator' | 'manager' | 'viewer';
}

export interface CrmBootstrap { requiresOnboarding: boolean; companies: CompanySummary[]; }

export async function loadCrmBootstrap(): Promise<CrmBootstrap> {
  const response = await authFetch('/api/crm/bootstrap');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || 'Не удалось загрузить CRM-профиль');
  return payload.data as CrmBootstrap;
}

export async function createFirstCompany(input: { name: string; timezone: string; locale?: string }) {
  const response = await authFetch('/api/crm/companies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || 'Не удалось создать компанию');
  localStorage.setItem('imds_active_company_id', payload.data.company.id);
  return payload.data;
}
