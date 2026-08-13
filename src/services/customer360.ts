export type Customer360Summary = {
  id: string; fullName: string; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; source?: string | null;
  createdAt: string; updatedAt: string; leadCount: number; dealCount: number; openDealCount: number; callCount: number; conversationCount: number; appointmentCount: number; revenue: number; lastActivityAt: string;
};

export type Customer360Detail = {
  contact: { id: string; fullName: string; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; source?: string | null; createdAt: string; updatedAt: string };
  leads: Array<{ id: string; name?: string | null; phone?: string | null; email?: string | null; source?: string | null; platform?: string | null; stage?: string | null; createdAt: string; updatedAt: string; dealId?: string | null }>;
  deals: Array<{ id: string; title: string; phone?: string | null; email?: string | null; source?: string | null; status: string; amount: number; currency: string; paid: boolean; priority: string; nextAction?: string | null; nextActionAt?: string | null; stageId: string; stageName?: string | null; pipelineId: string; pipelineName?: string | null; marketingLeadId?: string | null; createdAt: string; updatedAt: string }>;
  calls: Array<{ id: string; leadId?: string | null; conversationId?: string | null; phone?: string | null; status: string; channel?: string | null; direction?: string | null; startedAt: string; durationSeconds: number; result?: string | null; summary?: string | null; nextAction?: string | null; recordingUrl?: string | null }>;
  conversations: Array<{ id: string; leadId?: string | null; title?: string | null; phone?: string | null; channel: string; status: string; unreadCount: number; lastMessageAt?: string | null; assignedUserId?: string | null }>;
  messages: Array<{ id: string; conversationId: string; body?: string | null; direction: string; senderName?: string | null; status: string; sentAt: string; attachmentName?: string | null }>;
  appointments: Array<{ id: string; leadId?: string | null; conversationId?: string | null; patientId?: string | null; patientName?: string | null; phone?: string | null; status: string; source?: string | null; startsAt: string; endsAt: string; doctorId?: string | null; branchId?: string | null }>;
  journey: Array<{ id: string; leadId?: string | null; type: string; occurredAt: string; channel?: string | null; source?: string | null; value?: number | null; currency?: string | null; campaignId?: string | null; adsetId?: string | null; adId?: string | null }>;
  patients: Array<{ id: string; name: string; phone?: string | null; email?: string | null; sourceSystem?: string | null; lastVisitAt?: string | null; nextVisitAt?: string | null }>;
  tasks: Array<{ id: string; title: string; description?: string | null; status: string; priority: string; dueAt?: string | null; completedAt?: string | null; assigneeId?: string | null; linkType?: string | null; linkId?: string | null; linkLabel?: string | null }>;
  stats: { leadCount: number; dealCount: number; callCount: number; conversationCount: number; appointmentCount: number; revenue: number };
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const text = await response.text(); let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as { error?: unknown } : null;
    throw new Error(typeof record?.error === 'string' ? record.error : `HTTP ${response.status}`);
  }
  return payload as T;
}

export const customer360Api = {
  list: (query = '') => request<Customer360Summary[]>(`/api/customer360${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  detail: (contactId: string) => request<Customer360Detail>(`/api/customer360/${encodeURIComponent(contactId)}`),
  resolveLead: (leadId: string) => request<{ contactId: string | null }>(`/api/customer360?leadId=${encodeURIComponent(leadId)}`),
  update: (contactId: string, input: Partial<{ firstName: string | null; lastName: string | null; phone: string | null; email: string | null; source: string | null }>) => request<Customer360Detail>(`/api/customer360/${encodeURIComponent(contactId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  merge: (targetContactId: string, sourceContactId: string) => request<Customer360Detail>(`/api/customer360/${encodeURIComponent(targetContactId)}/merge`, { method: 'POST', body: JSON.stringify({ sourceContactId }) }),
};
