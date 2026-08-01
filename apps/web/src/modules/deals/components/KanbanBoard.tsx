import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Filter, LoaderCircle, Plus, Search, Workflow } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useBootstrapPipelineMutation, useCreateDealMutation, useDealsQuery, useMoveDealMutation, usePipelinesQuery } from '../api/useDeals';
import type { Deal } from '../types';
import { CreateLeadModal } from './CreateLeadModal';
import { DealDetailsPanel } from './DealDetailsPanel';
import { StageColumn } from './StageColumn';

export function KanbanBoard() {
  const { data: pipelines, isLoading: pipelinesLoading, refetch: refetchPipelines } = usePipelinesQuery();
  const bootstrapPipeline = useBootstrapPipelineMutation();
  const [pipelineId, setPipelineId] = useState<string>();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [seeding, setSeeding] = useState(true);
  const [seedError, setSeedError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function ensureWorkspace() {
      setSeeding(true);
      const { error } = await supabase.rpc('ensure_default_crm_workspace');
      if (cancelled) return;
      if (error) setSeedError(error.message);
      else await refetchPipelines();
      if (!cancelled) setSeeding(false);
    }
    void ensureWorkspace();
    return () => { cancelled = true; };
  }, [refetchPipelines]);

  useEffect(() => {
    if (!pipelineId && pipelines?.length) {
      setPipelineId(pipelines.find((pipeline) => pipeline.isDefault)?.id ?? pipelines[0].id);
    }
  }, [pipelineId, pipelines]);

  const { data: dealsData, isLoading: dealsLoading, refetch: refetchDeals } = useDealsQuery(pipelineId);
  const moveDeal = useMoveDealMutation(pipelineId);
  const createDeal = useCreateDealMutation(pipelineId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pipeline = useMemo(() => pipelines?.find((item) => item.id === pipelineId), [pipelines, pipelineId]);

  useEffect(() => {
    if (pipelineId && !seeding) void refetchDeals();
  }, [pipelineId, seeding, refetchDeals]);

  const dealsByStage = useMemo(() => {
    const map = new Map<string, NonNullable<typeof dealsData>['items']>();
    for (const stage of pipeline?.stages ?? []) map.set(stage.id, []);
    for (const deal of dealsData?.items ?? []) map.set(deal.stageId, [...(map.get(deal.stageId) ?? []), deal]);
    return map;
  }, [dealsData, pipeline]);

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const deal = dealsData?.items.find((item) => item.id === event.active.id);
    const targetStageId = String(event.over.id);
    if (!deal || deal.stageId === targetStageId) return;
    moveDeal.mutate({ id: deal.id, stageId: targetStageId, order: dealsByStage.get(targetStageId)?.length ?? 0 });
  }

  if (pipelinesLoading || seeding) return <div className="kanban-message"><LoaderCircle size={20} className="auth-spinner" /> Подготовка реальной воронки…</div>;
  if (!pipelines?.length) {
    return <section className="pipeline-onboarding">
      <span><Workflow size={28} /></span><h2>Настройте первую воронку</h2>
      <p>Будут созданы этапы: Новый лид, В работе, Назначена консультация, Продажа и Отказ.</p>
      <button disabled={bootstrapPipeline.isPending} onClick={() => bootstrapPipeline.mutate()}><Plus size={16} /> {bootstrapPipeline.isPending ? 'Создание…' : 'Создать стартовую воронку'}</button>
      {(bootstrapPipeline.isError || seedError) && <small>{seedError || 'Не удалось создать воронку. Проверьте API.'}</small>}
    </section>;
  }

  const selectedStage = selectedDeal ? pipeline?.stages.find((stage) => stage.id === selectedDeal.stageId) : undefined;

  return <section className="kanban-module">
    <header className="kanban-toolbar kanban-toolbar-reference">
      <select value={pipelineId} onChange={(event) => { setPipelineId(event.target.value); setSelectedDeal(null); }}>{pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label className="kanban-search"><Search size={15} /><input placeholder="Поиск" /></label>
      <button className="kanban-filter"><Filter size={15} /> Фильтр</button>
      <button className="kanban-add" onClick={() => setShowCreateLead(true)}><Plus size={16} /> Добавить</button>
      <span className="kanban-total">Всего лидов: {dealsData?.total ?? 0}</span>
    </header>

    {dealsLoading ? <div className="kanban-message">Загрузка сделок…</div> : <DndContext sensors={sensors} onDragEnd={handleDragEnd}><div className="kanban-board">{(pipeline?.stages ?? []).sort((a, b) => a.order - b.order).map((stage) => <StageColumn key={stage.id} stage={stage} deals={dealsByStage.get(stage.id) ?? []} isCreating={createDeal.isPending} onCreateDeal={(title, stageId) => createDeal.mutate({ title, stageId })} onOpenDeal={setSelectedDeal} />)}</div></DndContext>}

    {showCreateLead && pipeline && <CreateLeadModal pipeline={pipeline} isSubmitting={createDeal.isPending} onClose={() => setShowCreateLead(false)} onSubmit={(input) => createDeal.mutate(input, { onSuccess: () => setShowCreateLead(false) })} />}
    {selectedDeal && pipeline && selectedStage && <DealDetailsPanel deal={selectedDeal} pipeline={pipeline} stage={selectedStage} onClose={() => setSelectedDeal(null)} />}
  </section>;
}
