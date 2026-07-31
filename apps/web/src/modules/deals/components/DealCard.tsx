import { useDraggable } from '@dnd-kit/core';
import type { MouseEvent } from 'react';
import type { Deal } from '../types';

function formatTenge(value: string | null) {
  const amount = value ? Number(value) : 0;
  return amount ? `${new Intl.NumberFormat('ru-RU').format(amount)} ₸` : null;
}

export function DealCard({ deal, onOpen }: { deal: Deal; onOpen: (deal: Deal) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id, data: { deal } });
  const amount = formatTenge(deal.oneTimeAmount) ?? formatTenge(deal.recurringAmount);
  const contactName = deal.contact ? [deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(' ') : '';

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (isDragging) return;
    event.stopPropagation();
    onOpen(deal);
  };

  return (
    <article
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="deal-card"
      onClick={handleClick}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, opacity: isDragging ? 0.45 : 1 }}
    >
      <h4>{deal.title}</h4>
      {(deal.contact?.phone || contactName) && <p>{deal.contact?.phone ?? contactName}</p>}
      <footer>
        <strong>{amount ?? 'Без суммы'}</strong>
        {deal.manager && <span>{deal.manager.firstName[0]}{deal.manager.lastName[0]}</span>}
      </footer>
      {deal.tags.length > 0 && <div className="deal-tags">{deal.tags.map(({ tag }) => <i key={tag.id} style={{ background: tag.color }}>{tag.name}</i>)}</div>}
    </article>
  );
}
