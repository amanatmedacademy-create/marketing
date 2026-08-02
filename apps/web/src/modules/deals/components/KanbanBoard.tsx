import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Columns3, Filter, List, LoaderCircle, MoreVertical, Plus, Search, Workflow } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useBootstrapPipelineMutation, useCreateDealMutation, useDealsQuery, useDeleteDealMutation, useMoveDealMutation, usePipelinesQuery } from '../api/useDeals';
import type { Deal } from '../types';
import { CreateLeadModal } from './CreateLeadModal';
import { DealDetailsPanel } from './DealDetailsPanel';
import { LeadTable } from './LeadTable';
import { PipelineManagerModal } from './PipelineManagerModal';
import { StageColumn } from './StageColumn';

type ViewMode = 'kanban' | 'table';

export function KanbanBoard() {
  const { data: pipelines, isLoading: pipelinesLoading, refetch: refetchPipelines } = usePipelinesQuery();
  const bootstrapPipeline = useBootstrapPipelineMutation();
  const [pipelineId, setPipelineId] = useState<string>();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [showPipelineManager, setShowPipelineManager] = useState(false);
  const [seeding, setSeeding] = useState(true);
  const [seedError, setSeedError] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => localStorage.getItem('imds-leads-view') === 'table' ? 'table' : 'kanban');

  useEffect(() => {
    let cancelled = false;
    async function ensureWorkspace() {
      setSeeding(true);
      const { error } = await supabase.rpc('ensure_default_crm_workspace');
      if (cancelled) return;
      if (error) setSeedError(error.message); else await refetchPipelines();
      if (!cancelled) setSeeding(false);
    }
    void ensureWorkspace();
    return () => { cancelled = true; };
  }, [refetchPipelines]);

  useEffect(() => { if (!pipelineId && pipelines?.length) setPipelineId(pipelines.find((pipeline) => pipeline.isDefault)?.id ?? pipelines[0].id); }, [pipelineId, pipelines]);

  const { data: dealsData, isLoading: dealsLoading, refetch: refetchDeals } = useDealsQuery(pipelineId);
  const moveDeal = useMoveDealMutation(pipelineId);
  const createDeal = useCreateDealMutation(pipelineId);
  const deleteDeal = useDeleteDealMutation(pipelineId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pipeline = useMemo(() => pipelines?.find((item) => item.id === pipelineId), [pipelines, pipelineId]);

  useEffect(() => { if (pipelineId && !seeding) void refetchDeals(); }, [pipelineId, seeding, refetchDeals]);

  const filteredDeals = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return dealsData?.items ?? [];
    return (dealsData?.items ?? []).filter((deal) => [deal.title, deal.phone, deal.email, deal.source, deal.contact?.phone, deal.contact?.email].some((value) => value?.toLowerCase().includes(query)));
  }, [dealsData, search]);

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of pipeline?.stages ?? []) map.set(stage.id, []);
    for (const deal of filteredDeals) map.set(deal.stageId, [...(map.get(deal.stageId) ?? []), deal]);
    return map;
  }, [filteredDeals, pipeline]);

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const deal = dealsData?.items.find((item) => item.id === event.active.id);
    const targetStageId = String(event.over.id);
    if (!deal || deal.stageId === targetStageId) return;
    moveDeal.mutate({ id: deal.id, stageId: targetStageId, order: dealsByStage.get(targetStageId)?.length ?? 0 });
  }

  function changeView(next: ViewMode) { setViewMode(next); localStorage.setItem('imds-leads-view', next); }
  function removeDeal(deal: Deal) { if (window.confirm(`Удалить лид «${deal.title}»? Данные будут скрыты из CRM.`)) deleteDeal.mutate(deal.id, { onSuccess: () => { if (selectedDeal?.id === deal.id) setSelectedDeal(null); } }); }

  if (pipelinesLoading || seeding) return <div className="kanban-message"><LoaderCircle size={20} className="auth-spinner" /> Подготовка реальной воронки…</div>;
  if (!pipelines?.length) return <section className="pipeline-onboarding"><span><Workflow size={28} /></span><h2>Настройте первую воронку</h2><p>Будут созданы этапы: Новый лид, В работе, Назначена консультация, Продажа и Отказ.</p><button disabled={bootstrapPipeline.isPending} onClick={() => bootstrapPipeline.mutate()}><Plus size={16} /> {bootstrapPipeline.isPending ? 'Создание…' : 'Создать стартовую воронку'}</button>{(bootstrapPipeline.isError || seedError) && <small>{seedError || 'Не удалось создать воронку. Проверьте API.'}</small>}</section>;

  const selectedStage = selectedDeal ? pipeline?.stages.find((stage) => stage.id === selectedDeal.stageId) : undefined;

  return <section className="kanban-module">
    <header className="kanban-toolbar kanban-toolbar-reference">
      <select value={pipelineId} onChange={(event) => { setPipelineId(event.target.value); setSelectedDeal(null); }}>{pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label className="kanban-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по имени, телефону, email, источнику" /></label>
      <button className="kanban-filter"><Filter size={15} /> Фильтр</button>
      <button className="kanban-add" onClick={() => setShowCreateLead(true)}><Plus size={16} /> Добавить</button>
      <span className="kanban-total">Лидов: {filteredDeals.length} из {dealsData?.total ?? 0}</span>
      <div className="lead-view-switch"><button className={viewMode === 'kanban' ? 'active' : ''} onClick={() => changeView('kanban')} title="Канбан"><Columns3 size={16} /></button><button className={viewMode === 'table' ? 'active' : ''} onClick={() => changeView('table')} title="Таблица"><List size={16} /></button></div>
      <button className="kanban-more" title="Управление воронками" onClick={() => setShowPipelineManager(true)}><MoreVertical size={18} /></button>
    </header>

    {dealsLoading ? <div className="kanban-message">Загрузка сделок…</div> : viewMode === 'table' && pipeline ? <LeadTable deals={filteredDeals} pipeline={pipeline} deletingId={deleteDeal.isPending ? deleteDeal.variables : undefined} onOpen={setSelectedDeal} onDelete={removeDeal} /> : <DndContext sensors={sensors} onDragEnd={handleDragEnd}><div className="kanban-board">{(pipeline?.stages ?? []).sort((a, b) => a.order - b.order).map((stage) => <StageColumn key={stage.id} stage={stage} deals={dealsByStage.get(stage.id) ?? []} isCreating={createDeal.isPending} onCreateDeal={(title, stageId) => createDeal.mutate({ title, stageId })} onOpenDeal={setSelectedDeal} />)}</div></DndContext>}

    {deleteDeal.isError && <div className="lead-delete-error">{deleteDeal.error instanceof Error ? deleteDeal.error.message : 'Не удалось удалить лид'}</div>}
    {showCreateLead && pipeline && <CreateLeadModal pipeline={pipeline} isSubmitting={createDeal.isPending} onClose={() => setShowCreateLead(false)} onSubmit={(input) => createDeal.mutate(input, { onSuccess: () => setShowCreateLead(false) })} />}
    {selectedDeal && pipeline && selectedStage && <DealDetailsPanel deal={selectedDeal} pipeline={pipeline} stage={selectedStage} onClose={() => setSelectedDeal(null)} />}
    {showPipelineManager && <PipelineManagerModal pipelines={pipelines} currentPipelineId={pipelineId} onClose={() => setShowPipelineManager(false)} onSelect={(id) => { setPipelineId(id); setSelectedDeal(null); }} />}
  </section>;
}
