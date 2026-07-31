import { useMemo, useState } from 'react';
import { Archive, ChevronDown, CircleDollarSign, Clock3, FileText, Mail, MessageCircle, Phone, Plus, Send, StickyNote, UserRound, X } from 'lucide-react';
import type { Deal, Pipeline, PipelineStage } from '../types';

type Props = {
  deal: Deal;
  pipeline: Pipeline;
  stage: PipelineStage;
  onClose: () => void;
};

export function DealDetailsPanel({ deal, pipeline, stage, onClose }: Props) {
  const [tab, setTab] = useState<'chat' | 'tasks' | 'notes'>('chat');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const contactName = useMemo(() => {
    const value = deal.contact ? [deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(' ') : '';
    return value || deal.title;
  }, [deal]);
  const oneTime = Number(deal.oneTimeAmount ?? 0);
  const recurring = Number(deal.recurringAmount ?? 0);
  const total = oneTime + recurring;

  const addNote = () => {
    const value = note.trim();
    if (!value) return;
    setNotes((current) => [...current, value]);
    setNote('');
  };

  return <div className="deal-panel-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="deal-details-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="deal-details-head">
        <div><span>Сделка</span><h2>{deal.title}</h2></div>
        <button onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
      </header>

      <div className="deal-details-grid">
        <section className="deal-main-column">
          <div className="deal-contact-summary">
            <div className="deal-contact-avatar"><UserRound size={20} /></div>
            <div><strong>{contactName}</strong><span>{deal.contact?.phone ?? 'Телефон не указан'}</span></div>
            <button><Phone size={15} /> Позвонить</button>
            <button><MessageCircle size={15} /> WhatsApp</button>
          </div>

          <div className="deal-work-tabs">
            <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}><MessageCircle size={15} /> Чат</button>
            <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><Clock3 size={15} /> Задачи</button>
            <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}><StickyNote size={15} /> Заметки</button>
          </div>

          {tab === 'chat' && <div className="deal-chat-area">
            <div className="deal-chat-empty"><MessageCircle size={34} /><strong>Переписка по сделке</strong><span>После привязки WhatsApp-диалога сообщения появятся здесь.</span></div>
            <footer><button><Archive size={17} /></button><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Напишите сообщение…" /><button disabled={!message.trim()} onClick={() => setMessage('')}><Send size={17} /></button></footer>
          </div>}

          {tab === 'tasks' && <div className="deal-task-area"><button><Plus size={15} /> Добавить задачу</button><div><Clock3 size={30} /><strong>Задач по сделке пока нет</strong><span>Создайте звонок, встречу или напоминание.</span></div></div>}

          {tab === 'notes' && <div className="deal-notes-area"><div className="deal-note-form"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Новая заметка" /><button onClick={addNote}><Plus size={15} /></button></div>{notes.length ? notes.map((item, index) => <article key={`${item}-${index}`}><p>{item}</p><time>только что</time></article>) : <div className="deal-notes-empty"><StickyNote size={30} /><strong>Нет заметок</strong></div>}</div>}
        </section>

        <aside className="deal-info-column">
          <section><h3><UserRound size={16} /> Клиент</h3><dl><div><dt>Имя</dt><dd>{contactName}</dd></div><div><dt>Телефон</dt><dd>{deal.contact?.phone ?? '—'}</dd></div><div><dt>Email</dt><dd><Mail size={13} /> Не указан</dd></div><div><dt>Менеджер</dt><dd>{deal.manager ? `${deal.manager.firstName} ${deal.manager.lastName}` : 'Не назначен'}</dd></div></dl></section>

          <section><h3><CircleDollarSign size={16} /> Финансы</h3><dl><div><dt>Единый платёж</dt><dd>{oneTime.toLocaleString('ru-RU')} ₸</dd></div><div><dt>Ежемесячный</dt><dd>{recurring.toLocaleString('ru-RU')} ₸</dd></div><div className="deal-total-row"><dt>Общая сумма</dt><dd>{total.toLocaleString('ru-RU')} ₸</dd></div></dl></section>

          <section className="deal-stage-section"><label>Этап<button><span><i style={{ background: stage.color }} />{stage.name}</span><ChevronDown size={15} /></button></label><label>Воронка<button><span>{pipeline.name}</span><ChevronDown size={15} /></button></label></section>

          <section><h3><FileText size={16} /> Теги</h3><div className="deal-detail-tags">{deal.tags.length ? deal.tags.map(({ tag }) => <span key={tag.id} style={{ background: tag.color }}>{tag.name}</span>) : <em>Нет тегов</em>}</div></section>

          <button className="deal-files-button"><Archive size={15} /> Файлы сделки</button>
          <div className="deal-autosave"><Clock3 size={14} /> Изменения сохраняются автоматически</div>
        </aside>
      </div>
    </section>
  </div>;
}
