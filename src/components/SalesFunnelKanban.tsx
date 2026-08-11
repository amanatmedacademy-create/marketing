import { useMemo, type DragEvent, type MouseEvent } from 'react';
import { ArrowRight, CircleDollarSign, Clock3, MoreHorizontal, Settings2, UserRound } from 'lucide-react';
import { useDealWorkspaceController } from './DealWorkspaceController';
import type { FunnelDeal, FunnelPipeline, FunnelUser } from '../services/salesFunnel';

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
const PRIORITY: Record<FunnelDeal['priority'], string> = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', URGENT: 'Срочный' };

type Props = {
  pipelines: FunnelPipeline[];
  selectedPipelineId: string;
  deals: FunnelDeal[];
  users: FunnelUser[];
  draggingId: string | null;
  onSelectPipeline: (id: string) => void;
  onDraggingChange: (id: string | null) => void;
  onMove: (deal: FunnelDeal, stageId: string) => Promise<void> | void;
  onOpen?: (deal: FunnelDeal) => void;
  onCreatePipeline: () => void;
  onManagePipeline: () => void;
};

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}
function age(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
  if (hours < 1) return 'только что';
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}

export function SalesFunnelKanban({ pipelines, selectedPipelineId, deals, users, draggingId, onSelectPipeline, onDraggingChange, onMove, onCreatePipeline, onManagePipeline }: Props) {
  const { open } = useDealWorkspaceController();
  const pipeline = pipelines.find((item) => item.id === selectedPipelineId) || pipelines.find((item) => item.isDefault) || pipelines[0];
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  if (!pipeline) {
    return <section className="funnel-v2-empty-panel">
      <h2>Воронок пока нет</h2>
      <p>Создайте первую воронку и настройте последовательность стадий.</p>
      <button className="button button-primary" type="button" onClick={onCreatePipeline}>Создать воронку</button>
    </section>;
  }

  const openWorkspace = (deal: FunnelDeal, event?: MouseEvent) => {
    event?.stopPropagation();
    if (draggingId) return;
    open({ deal, pipeline, users });
  };

  const drop = async (stageId: string) => {
    const deal = deals.find((item) => item.id === draggingId);
    if (!deal || deal.stageId === stageId) { onDraggingChange(null); return; }
    await onMove(deal, stageId);
  };

  return <section className="funnel-v2-kanban-shell">
    <header className="funnel-v2-pipeline-bar">
      <div className="funnel-v2-pipeline-tabs" role="tablist" aria-label="Воронки продаж">
        {pipelines.map((item) => <button type="button" role="tab" aria-selected={item.id === pipeline.id} className={item.id === pipeline.id ? 'active' : ''} key={item.id} onClick={() => onSelectPipeline(item.id)}>
          <span>{item.name}</span>{item.isDefault && <i>Основная</i>}
        </button>)}
      </div>
      <div className="funnel-v2-pipeline-actions">
        <button type="button" className="button button-secondary" onClick={onManagePipeline}><Settings2 size={15}/> Настроить</button>
        <button type="button" className="button button-primary" onClick={onCreatePipeline}>+ Воронка</button>
      </div>
    </header>

    <div className="funnel-v2-stage-strip">
      {pipeline.stages.map((stage, index) => <span key={stage.id}><b style={{ borderColor: stage.color }}>{stage.name}</b>{index < pipeline.stages.length - 1 && <ArrowRight size={13}/>}</span>)}
    </div>

    <div className="funnel-v2-kanban-scroll">
      <div className="funnel-v2-board" style={{ gridTemplateColumns: `repeat(${Math.max(1, pipeline.stages.length)}, minmax(230px, 1fr))` }}>
        {pipeline.stages.map((stage) => {
          const stageDeals = deals.filter((deal) => deal.stageId === stage.id).sort((a, b) => a.position - b.position);
          const stageAmount = stageDeals.reduce((sum, deal) => sum + deal.amount, 0);
          return <article className={`funnel-v2-column ${draggingId ? 'drag-active' : ''}`} key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={() => void drop(stage.id)}>
            <header style={{ borderTopColor: stage.color }}>
              <div><strong>{stage.name}</strong><small>{stage.stageType === 'won' ? 'Успешно завершено' : stage.stageType === 'lost' ? 'Закрыто с потерей' : `Вероятность ${stage.probability}%`}</small></div>
              <span><b>{stageDeals.length}</b><em>{money.format(stageAmount)}</em></span>
            </header>
            <div className="funnel-v2-column-body">
              {stageDeals.map((deal) => <section className={`funnel-v2-deal priority-${deal.priority.toLowerCase()}`} key={deal.id} draggable
                onDragStart={(event: DragEvent) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', deal.id); onDraggingChange(deal.id); }}
                onDragEnd={() => onDraggingChange(null)} onClick={(event) => openWorkspace(deal, event)} onDoubleClick={(event) => openWorkspace(deal, event)} role="button" tabIndex={0}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openWorkspace(deal); }}>
                <header><span>{initials(deal.fullName)}</span><div><strong>{deal.fullName}</strong><small>{deal.phone || deal.email || 'Контакт не указан'}</small></div><i>{PRIORITY[deal.priority]}</i></header>
                <p>{deal.description || deal.nextAction || 'Следующее действие не назначено'}</p>
                <div className="funnel-v2-deal-owners">
                  <span><UserRound size={12}/><small>Менеджер</small><b>{usersById.get(deal.managerUserId || '')?.fullName || 'Не назначен'}</b></span>
                  <span><UserRound size={12}/><small>Диагност</small><b>{usersById.get(deal.diagnostUserId || '')?.fullName || 'Не назначен'}</b></span>
                </div>
                <div className="funnel-v2-deal-meta"><span>{deal.source}</span><span><Clock3 size={11}/>{age(deal.stageEnteredAt)}</span></div>
                {deal.amount > 0 && <div className="funnel-v2-deal-amount"><CircleDollarSign size={14}/><span>{deal.paid ? 'Оплачено' : 'Сумма сделки'}</span><strong>{money.format(deal.amount)}</strong></div>}
                {deal.nextActionAt && <div className={`funnel-v2-next-action ${new Date(deal.nextActionAt).getTime() < Date.now() && deal.status === 'open' ? 'overdue' : ''}`}><Clock3 size={12}/><span>{deal.nextAction || 'Следующее действие'}</span><time>{new Date(deal.nextActionAt).toLocaleString('ru-KZ')}</time></div>}
                {deal.lostReason && <div className="funnel-v2-lost">{deal.lostReason}</div>}
                <footer><button type="button" onClick={(event) => openWorkspace(deal, event)}><MoreHorizontal size={16}/> Открыть карточку</button></footer>
              </section>)}
              {!stageDeals.length && <div className="funnel-v2-column-empty">Перетащите сделку сюда</div>}
            </div>
          </article>;
        })}
      </div>
    </div>
  </section>;
}
