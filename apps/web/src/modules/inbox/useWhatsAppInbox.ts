import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backendApiFetch } from '../../lib/api-client';

export type WhatsAppMessage = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'LOCATION' | 'CONTACT' | 'TEMPLATE' | 'SYSTEM';
  text: string | null;
  mediaUrl: string | null;
  createdAt: string;
};

export type WhatsAppConversation = {
  id: string;
  contactName: string | null;
  contactPhone: string;
  status: 'OPEN' | 'PENDING' | 'CLOSED';
  unreadCount: number;
  lastMessageAt: string | null;
  channel: { id: string; name: string; phoneNumber: string | null };
  deal: { id: string; title: string; stageId: string; amount: string | number } | null;
  assignee: { id: string; firstName: string | null; lastName: string | null; avatarUrl: string | null } | null;
  messages: WhatsAppMessage[];
};

export type WhatsAppConversationDetails = Omit<WhatsAppConversation, 'messages'> & {
  channel: WhatsAppConversation['channel'] & { status: 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR' };
  messages: WhatsAppMessage[];
};

export function useWhatsAppConversations() {
  return useQuery({
    queryKey: ['whatsapp', 'conversations'],
    queryFn: () => backendApiFetch<WhatsAppConversation[]>('/api/v1/whatsapp/conversations'),
    retry: false,
  });
}

export function useWhatsAppConversation(conversationId: string | null) {
  return useQuery({
    queryKey: ['whatsapp', 'conversation', conversationId],
    queryFn: () => backendApiFetch<WhatsAppConversationDetails>(`/api/v1/whatsapp/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
    retry: false,
  });
}

export function useSendWhatsAppMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      backendApiFetch<WhatsAppMessage>(`/api/v1/whatsapp/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { type: 'TEXT', text },
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation', variables.conversationId] }),
      ]);
    },
  });
}

export function useUpdateWhatsAppConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, status }: { conversationId: string; status: 'OPEN' | 'PENDING' | 'CLOSED' }) =>
      backendApiFetch<WhatsAppConversationDetails>(`/api/v1/whatsapp/conversations/${conversationId}`, {
        method: 'PATCH',
        body: { status },
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation', variables.conversationId] }),
      ]);
    },
  });
}
