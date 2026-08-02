import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-client';
import { supabase } from '../../../lib/supabase';
import type { Deal, ListDealsResponse, Pipeline } from '../types';

type PipelineRow = { id: string; name: string; is_default: boolean; position: number };
type StageRow = { id: string; pipeline_id: string; name: string; color: string | null; position: number; stage_type: string };
type CompanyContextRow = { company_id: string };
type DealRow = {
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
  updated_at?: string | null;
};

type CreateDealInput = { title: string; stageId: string; phone?: string; email?: string; source?: string; amount?: number };
type UpdateDealInput = { title: string; phone?: string | null; email?: string | null; source?: string | null; amount?: number; stageId?: string };

const dealSelect = 'id,pipeline_id,stage_id,title,phone,email,source,amount,position,created_at,updated_at';

function mapDealRow(row: DealRow): Deal {
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
    updatedAt: row.updated_at ?? undefined,
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
    .select(dealSelect)
    .eq('pipeline_id', pipelineId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const items = ((data ?? []) as unknown as DealRow[]).map(mapDealRow);
  return { items, total: items.length, page: 1, pageSize: 100 };
}

async function loadDeals(pipelineId: string): Promise<ListDealsResponse> {
  try { return await apiFetch<ListDealsResponse>(`/deals?pipelineId=${pipelineId}&pageSize=100`); }
  catch { return loadDealsFromSupabase(pipelineId); }
}

async function loadDealFromSupabase(dealId: string): Promise<Deal> {
  const { data, error } = await supabase
    .from('crm_deals')
    .select(dealSelect)
    .eq('id', dealId)
    .is('deleted_at', null)
    .single();
  if (error) throw error;
  return mapDealRow(data as unknown as DealRow);
}

async function loadDeal(dealId: string): Promise<Deal> {
  try { return await apiFetch<Deal>(`/deals/${dealId}`); }
  catch { return loadDealFromSupabase(dealId); }
}

async function resolveStageStatus(stageId: string, pipelineId: string) {
  const { data, error } = await supabase
    .from('crm_pipeline_stages')
    .select('id,stage_type')
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Выбранный этап не принадлежит этой воронке.');
  return data.stage_type === 'won' ? 'won' : data.stage_type === 'lost' ? 'lost' : 'open';
}

async function createDealWithSupabase(input: CreateDealInput, pipelineId: string): Promise<Deal> {
  const [{ data: contextData, error: contextError }, status] = await Promise.all([
    supabase.rpc('resolve_company_context', { requested_company_id: null }),
    resolveStageStatus(input.stageId, pipelineId),
  ]);
  if (contextError) throw contextError;
  const context = (Array.isArray(contextData) ? contextData[0] : contextData) as CompanyContextRow | null;
  if (!context?.company_id) throw new Error('Не удалось определить компанию пользователя.');

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
  }).select(dealSelect).single();
  if (error) throw error;
  return mapDealRow(data as unknown as DealRow);
}

async function updateDealWithSupabase(dealId: string, pipelineId: string | undefined, input: UpdateDealInput): Promise<Deal> {
  const update: Record<string, string | number | null> = {
    title: input.title.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    source: input.source?.trim() || null,
    amount: Number(input.amount ?? 0),
    updated_at: new Date().toISOString(),
  };
  if (input.stageId) {
    if (!pipelineId) throw new Error('Воронка не выбрана.');
    update.stage_id = input.stageId;
    update.status = await resolveStageStatus(input.stageId, pipelineId);
  }
  const { data, error } = await supabase
    .from('crm_deals')
    .update(update)
    .eq('id', dealId)
    .is('deleted_at', null)
    .select(dealSelect)
    .single();
  if (error) throw error;
  return mapDealRow(data as unknown as DealRow);
}

async function moveDealWithSupabase(dealId: string, pipelineId: string | undefined, stageId: string, order: number): Promise<Deal> {
  if (!pipelineId) throw new Error('Воронка не выбрана.');
  const status = await resolveStageStatus(stageId, pipelineId);
  const { data, error } = await supabase
    .from('crm_deals')
    .update({ stage_id: stageId, position: order, status, updated_at: new Date().toISOString() })
    .eq('id', dealId)
    .eq('pipeline_id', pipelineId)
    .is('deleted_at', null)
    .select(dealSelect)
    .single();
  if (error) throw error;
  return mapDealRow(data as unknown as DealRow);
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
  return useQuery({ queryKey: ['deal', dealId], queryFn: () => loadDeal(dealId!), enabled: Boolean(dealId) });
}

export function useUpdateDealMutation(pipelineId: string | undefined, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateDealInput) => {
      try { return await apiFetch<Deal>(`/deals/${dealId}`, { method: 'PATCH', body: input }); }
      catch { return updateDealWithSupabase(dealId, pipelineId, input); }
    },
    onSuccess: (deal) => {
      queryClient.setQueryData(['deal', dealId], deal);
      queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], (current) => current ? { ...current, items: current.items.map((item) => item.id === deal.id ? deal : item) } : current);
      queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useMoveDealMutation(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stageId, order }: { id: string; stageId: string; order: number }) => {
      try { return await apiFetch<Deal>(`/deals/${id}/move`, { method: 'PATCH', body: { stageId, order } }); }
      catch { return moveDealWithSupabase(id, pipelineId, stageId, order); }
    },
    onMutate: async ({ id, stageId, order }) => {
      await queryClient.cancelQueries({ queryKey: ['deals', pipelineId] });
      const previous = queryClient.getQueryData<ListDealsResponse>(['deals', pipelineId]);
      if (previous) queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], { ...previous, items: previous.items.map((deal) => deal.id === id ? { ...deal, stageId, order } : deal) });
      return { previous };
    },
    onSuccess: (deal) => queryClient.setQueryData<ListDealsResponse>(['deals', pipelineId], (current) => current ? { ...current, items: current.items.map((item) => item.id === deal.id ? deal : item) } : current),
    onError: (_error, _variables, context) => { if (context?.previous) queryClient.setQueryData(['deals', pipelineId], context.previous); },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
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
      queryClient.setQueryData(['deal', deal.id], deal);
      queryClient.invalidateQueries({ queryKey: ['deals', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
