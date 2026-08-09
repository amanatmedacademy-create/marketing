export type Campaign = {
  id: string;
  name: string;
  channel: string;
  objective: string;
  owner: string;
  budget: number;
  status: 'Активна' | 'План' | 'Пауза' | 'Завершена';
  starts_on?: string | null;
  ends_on?: string | null;
};

export type MarketingTask = {
  id: string;
  title: string;
  owner: string;
  due_on?: string | null;
  priority: 'Высокий' | 'Средний' | 'Низкий';
  done: boolean;
};

export type ContentItem = {
  id: string;
  title: string;
  publish_on?: string | null;
  platform?: string | null;
  owner?: string | null;
  production_stage: string;
  status: string;
};

export type AutomationAction = {
  type: 'create_task' | 'update_lead_stage' | 'webhook' | string;
  title?: string;
  owner?: string;
  priority?: 'Высокий' | 'Средний' | 'Низкий' | string;
  dueDays?: number;
  stage?: string;
  url?: string;
  [key: string]: unknown;
};

export type AutomationRule = {
  id: string;
  name: string;
  trigger_text: string;
  action_text: string;
  enabled: boolean;
  trigger_type?: 'lead_created' | 'lead_stage' | 'unassigned_lead' | string | null;
  trigger_config?: Record<string, unknown>;
  actions?: AutomationAction[];
  last_run_at?: string | null;
  last_checked_at?: string | null;
  last_error?: string | null;
  run_count?: number;
};

export type LeadForm = {
  id: string;
  name: string;
  public_token: string;
  status: 'active' | 'inactive';
  source?: string | null;
  campaign?: string | null;
  success_message: string;
  fields: Array<{ key: string; label: string; required?: boolean }>;
  created_at?: string;
};

export type TrackingLink = {
  id: string;
  name: string;
  destination_url: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  final_url: string;
  created_at?: string;
};

export type MediaPlanItem = {
  id: string;
  month: string;
  channel: string;
  campaign?: string | null;
  planned_budget: number;
  target_leads: number;
  target_sales: number;
  target_revenue: number;
  owner?: string | null;
  status: 'План' | 'Активен' | 'Закрыт';
  created_at?: string;
};

export type AuditStatus = 'success' | 'error' | 'warning';
export type ActivityItem = {
  id: string;
  event_type: string;
  message: string;
  entity_type?: string | null;
  entity_id?: string | null;
  actor_id?: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  module?: string | null;
  action?: string | null;
  status?: AuditStatus | null;
  request_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type ActivityFilters = {
  module?: string;
  action?: string;
  status?: AuditStatus | '';
  actor?: string;
  entity_type?: string;
  event_type?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
};

type ResourceMap = {
  campaigns: Campaign;
  tasks: MarketingTask;
  content: ContentItem;
  automations: AutomationRule;
  forms: LeadForm;
  links: TrackingLink;
  'media-plan': MediaPlanItem;
  activity: ActivityItem;
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/operations${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error((await response.text()) || `Operations API error: ${response.status}`);
  return response.json() as Promise<T>;
}

function resourceApi<K extends Exclude<keyof ResourceMap, 'activity'>>(resource: K) {
  return {
    list: () => apiRequest<ResourceMap[K][]>(`/${resource}`),
    create: (payload: Partial<ResourceMap[K]>) => apiRequest<ResourceMap[K][]>(`/${resource}`, { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, payload: Partial<ResourceMap[K]>) => apiRequest<ResourceMap[K][]>(`/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (id: string) => apiRequest<ResourceMap[K][]>(`/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

const activityApi = {
  list: (filters: ActivityFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    return apiRequest<ActivityItem[]>(`/activity${params.size ? `?${params}` : ''}`);
  },
};

export const operationsApi = {
  campaigns: resourceApi('campaigns'),
  tasks: resourceApi('tasks'),
  content: resourceApi('content'),
  automations: resourceApi('automations'),
  forms: resourceApi('forms'),
  links: resourceApi('links'),
  mediaPlan: resourceApi('media-plan'),
  activity: activityApi,
};
