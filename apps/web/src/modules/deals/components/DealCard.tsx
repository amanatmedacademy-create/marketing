import { useDraggable } from '@dnd-kit/core';
import { CalendarDays, GripVertical, Mail, Phone } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Deal } from '../types';

function formatTenge(value: string | null) {
  const amount = value ? Number(value) : 0;
  return amount ? `${new Intl.NumberFormat('ru-RU').format(amount)} ₸` : null;
}

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date);
}

export function DealCard({ deal, onOpen }: { deal: Deal; onOpen: (deal: Deal) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id, data: { deal } });
  const amount = formatTenge(deal.oneTimeAmount) ?? formatTenge(deal.recurringAmount);
  const contactName = deal.contact ? [deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(' ') : '';
  const phone = deal.contact?.phone ?? deal.phone ?? null;
  const email = deal.contact?.email ?? deal.email ?? null;
  const date = formatDate(deal.createdAt);
  const managerInitials = deal.manager
    ? `${deal.manager.firstName[0] ?? ''}${deal.manager.lastName[0] ?? ''}`.toUpperCase()
    : null;

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
      className={`deal-card ${isDragging ? 'is-dragging' : ''}`}
      onClick={handleClick}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
    >
      <header className="deal-card-head">
        <div>
          {deal.source && <span className="deal-source">{deal.source}</span>}
          <h4>{deal.title}</h4>
        </div>
        <GripVertical size={15} className="deal-drag-handle" />
      </header>

      {(contactName || phone || email) && <div className="deal-contact-block">
        {contactName && <strong>{contactName}</strong>}
        {phone && <span><Phone size={12} />{phone}</span>}
        {!phone && email && <span><Mail size={12} />{email}</span>}
      </div>}

      {deal.tags.length > 0 && <div className="deal-tags">{deal.tags.slice(0, 3).map(({ tag }) => <i key={tag.id} style={{ background: tag.color }}>{tag.name}</i>)}</div>}

      <footer className="deal-card-footer">
        <strong>{amount ?? 'Без суммы'}</strong>
        <div>
          {date && <span className="deal-date"><CalendarDays size={12} />{date}</span>}
          {managerInitials && <span className="deal-manager" title={`${deal.manager?.firstName} ${deal.manager?.lastName}`}>{managerInitials}</span>}
        </div>
      </footer>
    </article>
  );
}
