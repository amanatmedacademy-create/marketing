import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Filter, LoaderCircle, MoreVertical, Plus, Search, Workflow, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useActionFeedback } from '../../system/ActionFeedback';
import { useBootstrapPipelineMutation, useCreateDealMutation, useDealsQuery, useMoveDealMutation, usePipelinesQuery } from '../api/useDeals';
import type { Deal } from '../types';
import { CreateLeadModal } from './CreateLeadModal';
import { DealDetailsPanel } from './DealDetailsPanel';
import { PipelineManagerModal } from './PipelineManagerModal';
import { StageColumn } from './StageColumn';

type SourceFilter = 'all' | 'with-source' | 'without-source';

function matchesSearch(deal: Deal, query: string) {
  if (!query) return true;
  const contactName = deal.contact ? `${deal.contact.firstName ?? ''} ${deal.contact.lastName ?? ''}` : '';
  return [deal.title, deal.phone, deal.email, deal.source, contactName, deal.contact?.phone, deal.contact?.email]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(query));
}

export function KanbanBoard() {
  const feedback = useActionFeedback();
  const { data: pipelines, isLoading: pipelinesLoading, refetch: refetchPipelines } = usePipelinesQuery();
  const bootstrapPipeline = useBootstrapPipelineMutation();
  const [pipelineId, setPipelineId] = useState<string>();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [showPipelineManager, setShowPipelineManager] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [seeding, setSeeding] = useState(true);
  const [seedError, setSeedError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function ensureWorkspace() {
      setSeeding(true);
      const { error } = await supabase.rpc('ensure_default_crm_workspace');
      if (cancelled) return;
      if (error) {
        setSeedError(error.message);
        feedback.error('Воронка не подготовлена', error.message);
      } else await refetchPipelines();
      if (!cancelled) setSeeding(false);
    }
    void ensureWorkspace();
    return () => { cancelled = true; };
  }, [feedback, refetchPipelines]);

  useEffect(() => {
    if (!pipelineId && pipelines?.length) setPipelineId(pipelines.find(pipeline => pipeline.isDefault)?.id ?? pipelines[0].id);
  }, [pipelineId, pipelines]);

  const { data: dealsData, isLoading: dealsLoading, isError: dealsError, error: dealsQueryError, refetch: refetchDeals } = useDealsQuery(pipelineId);
  const moveDeal = useMoveDealMutation(pipelineId);
  const createDeal = useCreateDealMutation(pipelineId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pipeline = useMemo(() => pipelines?.find(item => item.id === pipelineId), [pipelines, pipelineId]);

  useEffect(() => {
    if (pipelineId && !seeding) void refetchDeals();
  }, [pipelineId, seeding, refetchDeals]);

  const filteredDeals = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (dealsData?.items ?? []).filter(deal => {
      if (!matchesSearch(deal, normalized)) return false;
      if (sourceFilter === 'with-source' && !deal.source?.trim()) return false;
      if (sourceFilter === 'without-source' && deal.source?.trim()) return false;
      return true;
    });
  }, [dealsData, search, sourceFilter]);

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of pipeline?.stages ?? []) map.set(stage.id, []);
    for (const deal of filteredDeals) map.set(deal.stageId, [...(map.get(deal.stageId) ?? []), deal]);
    return map;
  }, [filteredDeals, pipeline]);

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const deal = dealsData?.items.find(item => item.id === event.active.id);
    const targetStageId = String(event.over.id);
    if (!deal || deal.stageId === targetStageId) return;
    const stageName = pipeline?.stages.find(stage => stage.id === targetStageId)?.name ?? 'новый этап';
    moveDeal.mutate(
      { id: deal.id, stageId: targetStageId, order: dealsByStage.get(targetStageId)?.length ?? 0 },
      {
        onSuccess: () => feedback.success('Сделка перемещена', `«${deal.title}» → ${stageName}`),
        onError: error => feedback.error('Не удалось переместить сделку', error instanceof Error ? error.message : 'Изменение отменено.'),
      },
    );
  }

  if (pipelinesLoading || seeding) return <div className="kanban-message"><LoaderCircle size={20} className="auth-spinner" /> Подготовка реальной воронки…</div>;
  if (!pipelines?.length) return <section className="pipeline-onboarding">
    <span><Workflow size={28} /></span><h2>Настройте первую воронку</h2>
    <p>Будут созданы этапы: Новый лид, В работе, Назначена консультация, Продажа и Отказ.</p>
    <button disabled={bootstrapPipeline.isPending} onClick={() => bootstrapPipeline.mutate(undefined, {
      onSuccess: () => feedback.success('Воронка создана', 'Стартовые этапы готовы к работе.'),
      onError: error => feedback.error('Не удалось создать воронку', error instanceof Error ? error.message : 'Проверьте подключение.'),
    })}><Plus size={16} /> {bootstrapPipeline.isPending ? 'Создание…' : 'Создать стартовую воронку'}</button>
    {(bootstrapPipeline.isError || seedError) && <small>{seedError || 'Не удалось создать воронку. Проверьте API.'}</small>}
  </section>;

  const selectedStage = selectedDeal ? pipeline?.stages.find(stage => stage.id === selectedDeal.stageId) : undefined;
  const createError = createDeal.error instanceof Error ? createDeal.error.message : createDeal.isError ? 'Не удалось создать лид.' : '';
  const hasActiveFilters = Boolean(search.trim()) || sourceFilter !== 'all';

  return <section className="kanban-module">
    <header className="kanban-toolbar kanban-toolbar-reference">
      <select value={pipelineId} onChange={event => { setPipelineId(event.target.value); setSelectedDeal(null); }}>{pipelines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label className="kanban-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Название, контакт, телефон, источник" />{search && <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')}><X size={13} /></button>}</label>
      <div className="kanban-filter-wrap">
        <button className={`kanban-filter ${hasActiveFilters ? 'active' : ''}`} onClick={() => setShowFilters(value => !value)}><Filter size={15} /> Фильтр{hasActiveFilters ? ` · ${filteredDeals.length}` : ''}</button>
        {showFilters && <div className="kanban-filter-menu">
          <strong>Источник лида</strong>
          <label><input type="radio" name="source-filter" checked={sourceFilter === 'all'} onChange={() => setSourceFilter('all')} /> Все сделки</label>
          <label><input type="radio" name="source-filter" checked={sourceFilter === 'with-source'} onChange={() => setSourceFilter('with-source')} /> С источником</label>
          <label><input type="radio" name="source-filter" checked={sourceFilter === 'without-source'} onChange={() => setSourceFilter('without-source')} /> Без источника</label>
          <button type="button" onClick={() => { setSearch(''); setSourceFilter('all'); setShowFilters(false); }}>Сбросить фильтры</button>
        </div>}
      </div>
      <button className="kanban-add" onClick={() => { createDeal.reset(); setShowCreateLead(true); }}><Plus size={16} /> Добавить</button>
      <span className="kanban-total">Показано: {filteredDeals.length} из {dealsData?.total ?? 0}</span>
      <button className="kanban-more" title="Управление воронками" onClick={() => setShowPipelineManager(true)}><MoreVertical size={18} /></button>
    </header>

    {dealsError && <div className="kanban-message error">{dealsQueryError instanceof Error ? dealsQueryError.message : 'Не удалось загрузить сделки.'}<button onClick={() => void refetchDeals()}>Повторить</button></div>}
    {!dealsError && (dealsLoading ? <div className="kanban-message">Загрузка сделок…</div> : <DndContext sensors={sensors} onDragEnd={handleDragEnd}><div className="kanban-board">{(pipeline?.stages ?? []).sort((a, b) => a.order - b.order).map(stage => <StageColumn key={stage.id} stage={stage} deals={dealsByStage.get(stage.id) ?? []} isCreating={createDeal.isPending} onCreateDeal={(title, stageId) => createDeal.mutate({ title, stageId }, {
      onSuccess: () => feedback.success('Лид создан', `«${title}» добавлен в этап «${stage.name}».`),
      onError: error => feedback.error('Не удалось создать лид', error instanceof Error ? error.message : 'Проверьте данные.'),
    })} onOpenDeal={setSelectedDeal} />)}</div></DndContext>)}

    {showCreateLead && pipeline && <CreateLeadModal pipeline={pipeline} isSubmitting={createDeal.isPending} error={createError} onClose={() => { if (!createDeal.isPending) { createDeal.reset(); setShowCreateLead(false); } }} onSubmit={input => createDeal.mutate(input, {
      onSuccess: deal => { feedback.success('Лид создан', `«${deal.title}» добавлен в воронку.`); createDeal.reset(); setShowCreateLead(false); },
      onError: error => feedback.error('Не удалось создать лид', error instanceof Error ? error.message : 'Проверьте заполненные поля.'),
    })} />}
    {selectedDeal && pipeline && selectedStage && <DealDetailsPanel deal={selectedDeal} pipeline={pipeline} stage={selectedStage} onClose={() => setSelectedDeal(null)} />}
    {showPipelineManager && <PipelineManagerModal pipelines={pipelines} currentPipelineId={pipelineId} onClose={() => setShowPipelineManager(false)} onSelect={id => { setPipelineId(id); setSelectedDeal(null); }} />}
  </section>;
}
