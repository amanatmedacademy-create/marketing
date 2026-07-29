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

export type AutomationRule = {
  id: string;
  name: string;
  trigger_text: string;
  action_text: string;
  enabled: boolean;
  last_run_at?: string | null;
};

export type ActivityItem = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
};

type ResourceMap = {
  campaigns: Campaign;
  tasks: MarketingTask;
  content: ContentItem;
  automations: AutomationRule;
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

function resourceApi<K extends keyof ResourceMap>(resource: K) {
  return {
    list: () => apiRequest<ResourceMap[K][]>(`/${resource}`),
    create: (payload: Partial<ResourceMap[K]>) => apiRequest<ResourceMap[K][]>(`/${resource}`, { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, payload: Partial<ResourceMap[K]>) => apiRequest<ResourceMap[K][]>(`/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (id: string) => apiRequest<ResourceMap[K][]>(`/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

export const operationsApi = {
  campaigns: resourceApi('campaigns'),
  tasks: resourceApi('tasks'),
  content: resourceApi('content'),
  automations: resourceApi('automations'),
  activity: resourceApi('activity'),
};
