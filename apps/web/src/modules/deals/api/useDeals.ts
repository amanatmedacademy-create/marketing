import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-client';
import { supabase } from '../../../lib/supabase';
import type { Deal, ListDealsResponse, Pipeline } from '../types';

type PipelineRow = { id: string; name: string; is_default: boolean; position: number };
type StageRow = { id: string; pipeline_id: string; name: string; color: string | null; position: number; stage_type: string };
type CompanyContextRow = { company_id: string };
type DealInsertRow = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  amount: number | string | null;
  position: number;
  created_at: string;
};

type CreateDealInput = { title: string; stageId: string; phone?: string; email?: string; source?: string; amount?: number };

function mapDealRow(row: DealInsertRow): Deal {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    title: row.title,
    oneTimeAmount: row.amount == null ? null : String(row.amount),
    recurringAmount: null,
    order: Number(row.position ?? 0),
    phone: row.phone,
    email: row.email,
    source: row.source,
    createdAt: row.created_at,
    contact: row.phone || row.email ? {
      id: row.id,
      firstName: row.title,
      lastName: null,
      phone: row.phone,
      email: row.email,
    } : null,
    manager: null,
    tags: [],
  };
}

async function loadPipelinesFromSupabase(): Promise<Pipeline[]> {
  const [{ data: pipelines, error: pipelinesError }, { data: stages, error: stagesError }] = await Promise.all([
    supabase.from('crm_pipelines').select('id,name,is_default,position').order('position', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('crm_pipeline_stages').select('id,pipeline_id,name,color,position,stage_type').order('position', { ascending: true }),
  ]);
  if (pipelinesError) throw pipelinesError;
  if (stagesError) throw stagesError;
  const stageRows = (stages ?? []) as StageRow[];
  return ((pipelines ?? []) as PipelineRow[]).map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.is_default,
    order: pipeline.position,
    stages: stageRows.filter((stage) => stage.pipeline_id === pipeline.id).map((stage) => ({
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
  try { return await apiFetch<Pipeline[]>('/pipelines'); }
  catch { return loadPipelinesFromSupabase(); }
}

async function loadDealsFromSupabase(pipelineId: string): Promise<ListDealsResponse> {
  const { data, error } = await supabase
    .from('crm_deals')
    .select('id,pipeline_id,stage_id,title,phone,email,source,amount,position,created_at')
    .eq('pipeline_id', pipelineId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const items = ((data ?? []) as DealInsertRow[]).map(mapDealRow);
  return { items, total: items.length, page: 1, pageSize: 100 };
}

async function loadDeals(pipelineId: string): Promise<ListDealsResponse> {
  try { return await apiFetch<ListDealsResponse>(`/deals?pipelineId=${pipelineId}&pageSize=100`); }
  catch { return loadDealsFromSupabase(pipelineId); }
}

async function createDealWithSupabase(input: CreateDealInput, pipelineId: string): Promise<Deal> {
  const [{ data: contextData, error: contextError }, { data: stageData, error: stageError }] = await Promise.all([
    supabase.rpc('resolve_company_context', { requested_company_id: null }),
    supabase.from('crm_pipeline_stages').select('id,stage_type').eq('id', input.stageId).eq('pipeline_id', pipelineId).maybeSingle(),
  ]);
  if (contextError) throw contextError;
  if (stageError) throw stageError;
  const context = (Array.isArray(contextData) ? contextData[0] : contextData) as CompanyContextRow | null;
  if (!context?.company_id) throw new Error('Не удалось определить компанию пользователя.');
  if (!stageData?.id) throw new Error('Выбранный этап не принадлежит этой воронке.');

  const status = stageData.stage_type === 'won' ? 'won' : stageData.stage_type === 'lost' ? 'lost' : 'open';
  const { data, error } = await supabase.from('crm_deals').insert({
    company_id: context.company_id,
    pipeline_id: pipelineId,
    stage_id: input.stageId,
    title: input.title.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    source: input.source?.trim() || null,
    amount: Number(input.amount ?? 0),
    currency: 'KZT',
    status,
    position: Date.now(),
  }).select('id,pipeline_id,stage_id,title,phone,email,source,amount,position,created_at').single();
  if (error) throw error;
  return mapDealRow(data as DealInsertRow);
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
  return useQuery({ queryKey: ['deals', pipelineId], queryFn: () => loadDeals(pipelineId!), enabled: Boolean(pipelineId) });
}

export function useDealQuery(dealId: string | undefined) {
  return useQuery({ queryKey: ['deal', dealId], queryFn: () => apiFetch<Deal>(`/deals/${dealId}`), enabled: Boolean(dealId) });
}

export function useUpdateDealMutation(pipelineId: string | undefined, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; phone?: string | null; email?: string | null; source?: string | null; amount?: number; stageId?: string }) => apiFetch<Deal>(`/deals/${dealId}`, { method: 'PATCH', body: input }),
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
    mutationFn: ({ id, stageId, order }: { id: string; stageId: string; order: number }) => apiFetch<Deal>(`/deals/${id}/move`, { method: 'PATCH', body: { stageId, order } }),
    onMutate: async ({ id, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ['deals', pipelineId] });
      const previous = queryClient.getQueryData<ListDealsResponse>(['deals', pipelineId]);
      if (previous) queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], { ...previous, items: previous.items.map((deal) => deal.id === id ? { ...deal, stageId } : deal) });
      return { previous };
    },
    onError: (_error, _variables, context) => { if (context?.previous) queryClient.setQueryData(['deals', pipelineId], context.previous); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] }),
  });
}

export function useCreateDealMutation(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDealInput) => {
      if (!pipelineId) throw new Error('Воронка не выбрана.');
      try {
        return await apiFetch<Deal>('/deals', { method: 'POST', body: { ...input, pipelineId } });
      } catch (apiError) {
        try { return await createDealWithSupabase(input, pipelineId); }
        catch (supabaseError) {
          const apiMessage = apiError instanceof Error ? apiError.message : 'Worker API недоступен';
          const dbMessage = supabaseError instanceof Error ? supabaseError.message : 'Supabase отклонил создание';
          throw new Error(`${apiMessage}. Резервное создание: ${dbMessage}`);
        }
      }
    },
    onSuccess: (deal) => {
      queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], (current) => current ? { ...current, total: current.total + 1, items: [...current.items, deal] } : { items: [deal], total: 1, page: 1, pageSize: 100 });
      queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
