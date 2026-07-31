import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useCreateDealMutation, useDealsQuery, useMoveDealMutation, usePipelinesQuery } from '../api/useDeals';
import { StageColumn } from './StageColumn';

export function KanbanBoard() {
  const { data: pipelines, isLoading: pipelinesLoading } = usePipelinesQuery();
  const [pipelineId, setPipelineId] = useState<string>();

  useEffect(() => {
    if (!pipelineId && pipelines?.length) setPipelineId(pipelines.find((pipeline) => pipeline.isDefault)?.id ?? pipelines[0].id);
  }, [pipelineId, pipelines]);

  const { data: dealsData, isLoading: dealsLoading } = useDealsQuery(pipelineId);
  const moveDeal = useMoveDealMutation(pipelineId);
  const createDeal = useCreateDealMutation(pipelineId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pipeline = useMemo(() => pipelines?.find((item) => item.id === pipelineId), [pipelines, pipelineId]);

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

  if (pipelinesLoading) return <div className="kanban-message">Загрузка воронок…</div>;
  if (!pipelines?.length) return <div className="kanban-message">Пока нет ни одной воронки.</div>;

  return (
    <section className="kanban-module">
      <header className="kanban-toolbar">
        <div><span>CRM</span><h1>Сделки</h1></div>
        <select value={pipelineId} onChange={(event) => setPipelineId(event.target.value)}>
          {pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <b>{dealsData?.total ?? 0} сделок</b>
      </header>

      {dealsLoading ? <div className="kanban-message">Загрузка сделок…</div> : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="kanban-board">
            {(pipeline?.stages ?? []).sort((a, b) => a.order - b.order).map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={dealsByStage.get(stage.id) ?? []}
                isCreating={createDeal.isPending}
                onCreateDeal={(title, stageId) => createDeal.mutate({ title, stageId })}
              />
            ))}
          </div>
        </DndContext>
      )}
    </section>
  );
}
