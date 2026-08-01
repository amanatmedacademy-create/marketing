import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-client';
import { supabase } from '../../../lib/supabase';
import type { Deal, ListDealsResponse, Pipeline } from '../types';

export function usePipelinesQuery() {
  return useQuery({ queryKey: ['pipelines'], queryFn: () => apiFetch<Pipeline[]>('/pipelines') });
}

export function useBootstrapPipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => apiFetch<Pipeline>('/pipelines/bootstrap', { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }) });
}

export function useDealsQuery(pipelineId: string | undefined) {
  return useQuery({ queryKey: ['deals', pipelineId], queryFn: () => apiFetch<ListDealsResponse>(`/deals?pipelineId=${pipelineId}&pageSize=100`), enabled: Boolean(pipelineId) });
}

export function useDealQuery(dealId: string | undefined) {
  return useQuery({ queryKey: ['deal', dealId], queryFn: () => apiFetch<Deal>(`/deals/${dealId}`), enabled: Boolean(dealId) });
}

export function useUpdateDealMutation(pipelineId: string | undefined, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; phone?: string | null; email?: string | null; source?: string | null; amount?: number; stageId?: string }) => apiFetch<Deal>(`/deals/${dealId}`, { method: 'PATCH', body: input }),
    onSuccess: (deal) => { queryClient.setQueryData(['deal', dealId], deal); queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] }); queryClient.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useMoveDealMutation(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stageId, order }: { id: string; stageId: string; order: number }) => apiFetch<Deal>(`/deals/${id}/move`, { method: 'PATCH', body: { stageId, order } }),
    onMutate: async ({ id, stageId }) => { await queryClient.cancelQueries({ queryKey: ['deals', pipelineId] }); const previous = queryClient.getQueryData<ListDealsResponse>(['deals', pipelineId]); if (previous) queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], { ...previous, items: previous.items.map((deal) => deal.id === id ? { ...deal, stageId } : deal) }); return { previous }; },
    onError: (_error, _variables, context) => { if (context?.previous) queryClient.setQueryData(['deals', pipelineId], context.previous); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] }),
  });
}

export function useCreateDealMutation(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: { title: string; stageId: string; phone?: string; email?: string; source?: string; amount?: number }) => apiFetch<Deal>('/deals', { method: 'POST', body: { ...input, pipelineId } }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] }) });
}

export function useDeleteDealMutation(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const { error } = await supabase.from('crm_deals').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', dealId);
      if (error) throw error;
      return dealId;
    },
    onSuccess: (dealId) => {
      queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], (current) => current ? { ...current, total: Math.max(0, current.total - 1), items: current.items.filter((deal) => deal.id !== dealId) } : current);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
