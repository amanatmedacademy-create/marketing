// Колл-Центр: клиент API, порт inboxApi из МИС.
// Auth-заголовок добавляет глобальный fetch-патч в AuthGate.

export type ChatDirection = 'INBOUND' | 'OUTBOUND';
export type ChatStatus = 'OPEN' | 'PENDING' | 'CLOSED';

export type ChatMessage = {
  id: string;
  threadId: string;
  direction: ChatDirection;
  senderName?: string;
  body: string;
  status: string;
  externalId?: string;
  readAt?: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentSizeBytes?: number;
  hasAttachment: boolean;
  sentAt: string;
};

export type ChatContact = {
  id: string;
  fullName: string;
  phone?: string;
  source?: string;
  stage?: string;
  utmSource?: string;
  firstMessage?: string;
};

export type ChatFunnelLead = {
  id: string;
  contactId?: string;
  stage: string;
  priority: string;
  amount: number;
  source: string;
};

export type ChatUser = { id: string; fullName: string; role: string; active: boolean };

export type ChatThread = {
  id: string;
  leadId?: string;
  channel: string;
  title?: string;
  phone?: string;
  status: ChatStatus;
  assignedUserId?: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  contact?: ChatContact;
  funnelLead?: ChatFunnelLead;
  assignedUser?: ChatUser;
  lastMessage?: ChatMessage;
  unreadCount?: number;
};

export type ChatWorkspace = {
  threads: ChatThread[];
  users: ChatUser[];
};

export type ChatAttachmentInput = {
  name: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
};

export type ChatMessagePage = {
  messages: ChatMessage[];
  hasMore: boolean;
  nextBefore?: string;
};

class CallCenterApiError extends Error {
  constructor(message: string, readonly status?: number, readonly requestId?: string) {
    super(message);
    this.name = 'CallCenterApiError';
  }
}

async function rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api/callcenter${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...init.headers }
  });
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new CallCenterApiError(payload?.error || `API колл-центра вернул HTTP ${response.status}`, response.status, requestId);
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await rawRequest(path, init);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const fetchChatWorkspace = () => request<ChatWorkspace>('/workspace');

export async function fetchChatMessagePage(threadId: string, options: { before?: string; limit?: number } = {}): Promise<ChatMessagePage> {
  const params = new URLSearchParams();
  params.set('limit', String(Math.min(200, Math.max(20, options.limit ?? 100))));
  if (options.before) params.set('before', options.before);
  const response = await rawRequest(`/threads/${encodeURIComponent(threadId)}/messages?${params.toString()}`);
  const messages = await response.json() as ChatMessage[];
  return {
    messages,
    hasMore: response.headers.get('x-inbox-has-more') === '1',
    nextBefore: response.headers.get('x-inbox-next-before') || undefined
  };
}

export const fetchChatMessages = async (threadId: string): Promise<ChatMessage[]> =>
  (await fetchChatMessagePage(threadId)).messages;

export const createChatThread = (input: { leadId?: string; channel?: string; title?: string; phone?: string; assignedUserId?: string }) =>
  request<ChatThread>('/threads', { method: 'POST', body: JSON.stringify(input) });

export const updateChatThread = (id: string, input: { status?: ChatStatus; assignedUserId?: string | null; title?: string }) =>
  request<ChatThread>(`/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });

export const sendChatMessage = (threadId: string, body: string, senderName: string, attachment?: ChatAttachmentInput) =>
  request<ChatMessage>(`/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, direction: 'OUTBOUND', senderName, attachment })
  });

export const markChatThreadRead = (threadId: string) =>
  request<{ ok: boolean; readAt: string }>(`/threads/${encodeURIComponent(threadId)}/read`, { method: 'PATCH', body: '{}' });

export const getChatAttachmentUrl = (messageId: string) => `/api/callcenter/attachments/${encodeURIComponent(messageId)}`;
