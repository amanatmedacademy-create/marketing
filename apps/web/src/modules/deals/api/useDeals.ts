import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-client';
import { supabase } from '../../../lib/supabase';
import type { Deal, ListDealsResponse, Pipeline } from '../types';

type PipelineRow = {
  id: string;
  name: string;
  is_default: boolean;
  position: number;
};

type StageRow = {
  id: string;
  pipeline_id: string;
  name: string;
  color: string | null;
  position: number;
  stage_type: string;
};

async function loadPipelinesFromSupabase(): Promise<Pipeline[]> {
  const [{ data: pipelines, error: pipelinesError }, { data: stages, error: stagesError }] = await Promise.all([
    supabase
      .from('crm_pipelines')
      .select('id,name,is_default,position')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('crm_pipeline_stages')
      .select('id,pipeline_id,name,color,position,stage_type')
      .order('position', { ascending: true }),
  ]);

  if (pipelinesError) throw pipelinesError;
  if (stagesError) throw stagesError;

  const stageRows = (stages ?? []) as StageRow[];
  return ((pipelines ?? []) as PipelineRow[]).map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.is_default,
    order: pipeline.position,
    stages: stageRows
      .filter((stage) => stage.pipeline_id === pipeline.id)
      .map((stage) => ({
        id: stage.id,
        pipelineId: stage.pipeline_id,
        name: stage.name,
        color: stage.color ?? '#64748B',
        order: stage.position,
        isWon: stage.stage_type === 'won',
        isLost: stage.stage_type === 'lost',
        affectsRevenue: stage.stage_type !== 'lost',
      })),
  }));
}

async function loadPipelines(): Promise<Pipeline[]> {
  try {
    return await apiFetch<Pipeline[]>('/pipelines');
  } catch {
    return loadPipelinesFromSupabase();
  }
}

export function usePipelinesQuery() {
  return useQuery({ queryKey: ['pipelines'], queryFn: loadPipelines });
}

export function useBootstrapPipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('ensure_default_crm_workspace');
      if (error) throw error;

      const pipelines = await loadPipelinesFromSupabase();
      const pipeline = pipelines.find((item) => item.isDefault) ?? pipelines[0];
      if (!pipeline) throw new Error('Supabase не создал стартовую воронку.');
      return pipeline;
    },
    onSuccess: (pipeline) => {
      queryClient.setQueryData<Pipeline[]>(['pipelines'], (current) => {
        if (!current?.length) return [pipeline];
        return current.some((item) => item.id === pipeline.id) ? current : [...current, pipeline];
      });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useDealsQuery(pipelineId: string | undefined) {
  return useQuery({
    queryKey: ['deals', pipelineId],
    queryFn: () => apiFetch<ListDealsResponse>(`/deals?pipelineId=${pipelineId}&pageSize=100`),
    enabled: Boolean(pipelineId),
  });
}

export function useDealQuery(dealId: string | undefined) {
  return useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => apiFetch<Deal>(`/deals/${dealId}`),
    enabled: Boolean(dealId),
  });
}

export function useUpdateDealMutation(pipelineId: string | undefined, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; phone?: string | null; email?: string | null; source?: string | null; amount?: number; stageId?: string }) =>
      apiFetch<Deal>(`/deals/${dealId}`, { method: 'PATCH', body: input }),
    onSuccess: (deal) => {
      queryClient.setQueryData(['deal', dealId], deal);
      queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
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
    mutationFn: (input: { title: string; stageId: string; phone?: string; email?: string; source?: string; amount?: number }) =>
      apiFetch<Deal>('/deals', { method: 'POST', body: { ...input, pipelineId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] }),
  });
}
