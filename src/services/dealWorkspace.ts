export type DealWorkspaceActivityType = 'comment' | 'task' | 'note';

export type DealWorkspaceActivity = {
  id: string;
  dealId: string;
  type: DealWorkspaceActivityType;
  body: string;
  dueAt?: string;
  completedAt?: string;
  actorUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type DealWorkspaceMessage = {
  id: string;
  conversationId: string;
  body: string;
  direction: string;
  senderName?: string;
  status: string;
  sentAt: string;
  attachmentName?: string;
  attachmentMimeType?: string;
};

export type DealWorkspaceCall = {
  id: string;
  leadId?: string;
  operatorName?: string;
  clientPhone?: string;
  channel?: string;
  status: string;
  startedAt: string;
  scheduledAt?: string;
  durationSeconds: number;
  recordingUrl?: string;
  summary?: string;
  result?: string;
  nextAction?: string;
};

export type DealWorkspaceStageEvent = {
  id: string;
  dealId: string;
  pipelineId: string;
  fromStageId?: string;
  toStageId: string;
  actorUserId?: string;
  reason?: string;
  createdAt: string;
};

export type DealWorkspaceConversation = {
  id: string;
  leadId?: string;
  title?: string;
  phone?: string;
  channel: string;
  status: string;
  assignedUserId?: string;
  unreadCount: number;
  lastMessageAt?: string;
};

export type DealWorkspaceUser = { id: string; fullName: string };

export type DealWorkspacePayload = {
  activities: DealWorkspaceActivity[];
  messages: DealWorkspaceMessage[];
  calls: DealWorkspaceCall[];
  stageEvents: DealWorkspaceStageEvent[];
  conversations: DealWorkspaceConversation[];
  users: DealWorkspaceUser[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as { error?: unknown }
      : null;
    throw new Error(typeof record?.error === 'string' ? record.error : `HTTP ${response.status}`);
  }
  return payload as T;
}

export const fetchDealWorkspace = (dealId: string) =>
  request<DealWorkspacePayload>(`/api/deal-workspace/${encodeURIComponent(dealId)}`);

export const createDealWorkspaceActivity = (
  dealId: string,
  input: { type: DealWorkspaceActivityType; body: string; dueAt?: string | null },
) => request<DealWorkspaceActivity>(`/api/deal-workspace/${encodeURIComponent(dealId)}/activities`, {
  method: 'POST',
  body: JSON.stringify(input),
});

export const updateDealWorkspaceActivity = (
  dealId: string,
  activityId: string,
  input: { body?: string; dueAt?: string | null; completed?: boolean },
) => request<DealWorkspaceActivity>(`/api/deal-workspace/${encodeURIComponent(dealId)}/activities/${encodeURIComponent(activityId)}`, {
  method: 'PATCH',
  body: JSON.stringify(input),
});
