import { useDroppable } from '@dnd-kit/core';
import { useState, type FormEvent } from 'react';
import type { Deal, PipelineStage } from '../types';
import { DealCard } from './DealCard';

interface Props {
  stage: PipelineStage;
  deals: Deal[];
  onCreateDeal: (title: string, stageId: string) => void;
  onOpenDeal: (deal: Deal) => void;
  isCreating: boolean;
}

export function StageColumn({ stage, deals, onCreateDeal, onOpenDeal, isCreating }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const total = deals.reduce((sum, deal) => sum + Number(deal.oneTimeAmount ?? 0) + Number(deal.recurringAmount ?? 0), 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onCreateDeal(title.trim(), stage.id);
    setTitle('');
    setAdding(false);
  }

  return (
    <section className={`stage-column ${isOver ? 'is-over' : ''}`}>
      <header>
        <span style={{ background: stage.color }} />
        <h3>{stage.name}</h3>
        <b>{deals.length}</b>
      </header>
      {total > 0 && <small>{new Intl.NumberFormat('ru-RU').format(total)} ₸</small>}
      <div ref={setNodeRef} className="stage-dropzone">
        {deals.map((deal) => <DealCard key={deal.id} deal={deal} onOpen={onOpenDeal} />)}
      </div>
      {adding ? (
        <form onSubmit={submit} className="quick-deal-form">
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название сделки" />
          <button disabled={isCreating}>Добавить</button>
        </form>
      ) : (
        <button className="quick-add-button" onClick={() => setAdding(true)}>+ Быстрое добавление</button>
      )}
    </section>
  );
}
