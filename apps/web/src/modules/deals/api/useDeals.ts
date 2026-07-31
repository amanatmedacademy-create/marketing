import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-client';
import type { Deal, ListDealsResponse, Pipeline } from '../types';

export function usePipelinesQuery() {
  return useQuery({ queryKey: ['pipelines'], queryFn: () => apiFetch<Pipeline[]>('/pipelines') });
}

export function useDealsQuery(pipelineId: string | undefined) {
  return useQuery({
    queryKey: ['deals', pipelineId],
    queryFn: () => apiFetch<ListDealsResponse>(`/deals?pipelineId=${pipelineId}&pageSize=100`),
    enabled: Boolean(pipelineId),
  });
}

export function useMoveDealMutation(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stageId, order }: { id: string; stageId: string; order: number }) =>
      apiFetch<Deal>(`/deals/${id}/move`, { method: 'PATCH', body: { stageId, order } }),
    onMutate: async ({ id, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ['deals', pipelineId] });
      const previous = queryClient.getQueryData<ListDealsResponse>(['deals', pipelineId]);
      if (previous) {
        queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], {
          ...previous,
          items: previous.items.map((deal) => deal.id === id ? { ...deal, stageId } : deal),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['deals', pipelineId], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] }),
  });
}

export function useCreateDealMutation(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; stageId: string }) =>
      apiFetch<Deal>('/deals', { method: 'POST', body: { ...input, pipelineId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] }),
  });
}
