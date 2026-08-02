import { Pencil, Trash2 } from 'lucide-react';
import type { Deal, Pipeline } from '../types';

type Props = {
  deals: Deal[];
  pipeline: Pipeline;
  deletingId?: string;
  onOpen: (deal: Deal) => void;
  onDelete: (deal: Deal) => void;
};

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });

export function LeadTable({ deals, pipeline, deletingId, onOpen, onDelete }: Props) {
  const stageMap = new Map(pipeline.stages.map((stage) => [stage.id, stage]));

  if (!deals.length) return <div className="empty-state">Лиды не найдены</div>;

  return <div className="lead-table-wrap">
    <table className="lead-table">
      <thead><tr><th>Лид</th><th>Контакты</th><th>Источник</th><th>Этап</th><th>Сумма</th><th aria-label="Действия" /></tr></thead>
      <tbody>{deals.map((deal) => {
        const stage = stageMap.get(deal.stageId);
        const phone = deal.phone ?? deal.contact?.phone ?? '—';
        const email = deal.email ?? deal.contact?.email ?? '—';
        return <tr key={deal.id} onDoubleClick={() => onOpen(deal)}>
          <td><button className="lead-name-button" onClick={() => onOpen(deal)}>{deal.title}</button></td>
          <td><span>{phone}</span><small>{email}</small></td>
          <td>{deal.source || '—'}</td>
          <td><span className="lead-stage-badge"><i style={{ background: stage?.color ?? '#94a3b8' }} />{stage?.name ?? 'Без этапа'}</span></td>
          <td>{money.format(Number(deal.oneTimeAmount ?? 0))}</td>
          <td><div className="lead-row-actions"><button title="Редактировать" onClick={() => onOpen(deal)}><Pencil size={15} /></button><button className="danger" title="Удалить" disabled={deletingId === deal.id} onClick={() => onDelete(deal)}><Trash2 size={15} /></button></div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
