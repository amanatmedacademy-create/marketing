import { useMemo, useState } from 'react';
import { Archive, ChevronDown, CircleDollarSign, Clock3, FileText, Instagram, Mail, MessageCircle, MoreVertical, Paperclip, Phone, Plus, Search, Send, StickyNote, UserRound, Video } from 'lucide-react';

export type InboxChannel = 'whatsapp' | 'instagram' | 'email';

type Conversation = {
  id: string;
  channel: InboxChannel;
  name: string;
  handle: string;
  preview: string;
  time: string;
  unread: number;
  stage: string;
  amount: number;
};

const conversations: Conversation[] = [
  { id: 'c1', channel: 'whatsapp', name: 'Айгерим К.', handle: '+7 701 555 12 44', preview: 'Здравствуйте, хочу записаться на консультацию', time: '03:42', unread: 2, stage: 'Новый лид', amount: 0 },
  { id: 'c2', channel: 'instagram', name: 'Марат С.', handle: '@marat.s', preview: 'Можно узнать цену курса?', time: '03:18', unread: 1, stage: 'В работе', amount: 25000 },
  { id: 'c3', channel: 'email', name: 'Ольга В.', handle: 'olga@example.com', preview: 'Результаты МРТ во вложении', time: 'Вчера', unread: 0, stage: 'Консультация', amount: 18000 },
];

const labels: Record<InboxChannel, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', email: 'Email' };
const icons = { whatsapp: MessageCircle, instagram: Instagram, email: Mail };

export function OmnichannelInbox({ initialChannel }: { initialChannel: InboxChannel }) {
  const [channel, setChannel] = useState<InboxChannel>(initialChannel);
  const [selectedId, setSelectedId] = useState('c1');
  const [message, setMessage] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [rightTab, setRightTab] = useState<'notes' | 'calls'>('notes');

  const visible = useMemo(() => conversations.filter(item => item.channel === channel), [channel]);
  const selected = conversations.find(item => item.id === selectedId && item.channel === channel) ?? visible[0] ?? conversations[0];
  const SelectedIcon = icons[selected.channel];

  const selectChannel = (next: InboxChannel) => {
    setChannel(next);
    const first = conversations.find(item => item.channel === next);
    if (first) setSelectedId(first.id);
  };

  const saveNote = () => {
    const value = noteDraft.trim();
    if (!value) return;
    setNotes(current => [...current, value]);
    setNoteDraft('');
  };

  return <div className="omni-shell">
    <aside className="omni-list-pane">
      <div className="omni-channel-tabs">{(['whatsapp', 'instagram', 'email'] as InboxChannel[]).map(item => { const Icon = icons[item]; return <button key={item} className={channel === item ? 'active' : ''} onClick={() => selectChannel(item)}><Icon size={16} />{labels[item]}</button>; })}</div>
      <div className="omni-list-head"><div><h2>{labels[channel]}</h2><span>{visible.length} диалог</span></div><button><MoreVertical size={17} /></button></div>
      <label className="omni-search"><Search size={15} /><input placeholder="Поиск контакта" /></label>
      <div className="omni-filters"><button className="active">Все</button><button>Новые</button><button>Без ответа</button></div>
      <div className="omni-conversations">{visible.map(item => { const Icon = icons[item.channel]; return <button className={selected.id === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedId(item.id)}><span className={`omni-avatar ${item.channel}`}><Icon size={17} /></span><span className="omni-conversation-copy"><strong>{item.name}</strong><small>{item.preview}</small></span><span className="omni-conversation-meta"><time>{item.time}</time>{item.unread > 0 && <b>{item.unread}</b>}</span></button>; })}</div>
    </aside>

    <section className="omni-chat-pane">
      <header className="omni-chat-head"><div className={`omni-avatar ${selected.channel}`}><SelectedIcon size={17} /></div><div><strong>{selected.name}</strong><span>{selected.handle}</span></div><label><Search size={15} /><input placeholder="Поиск" /></label><button><Plus size={15} /> Добавить задачу</button></header>
      <div className="omni-channel-warning">Отправлять с: <strong>{labels[selected.channel]}</strong> · канал требует подключения аккаунта</div>
      <div className="omni-messages"><span className="omni-day">Сегодня</span><div className="omni-system-message">Лид создан · 03:22</div><div className="omni-message incoming"><p>{selected.preview}</p><time>{selected.time}</time></div><div className="omni-message outgoing"><p>Здравствуйте! Подскажите, пожалуйста, что вас беспокоит и как давно?</p><time>03:44</time></div></div>
      <div className="omni-composer-warning">Добавьте или подтвердите контакт клиента для отправки сообщений</div>
      <footer className="omni-composer"><button><Paperclip size={17} /></button><textarea value={message} onChange={event => setMessage(event.target.value)} placeholder={channel === 'email' ? 'Текст письма…' : 'Напишите сообщение…'} /><button className="omni-template"><FileText size={17} /></button><button className="omni-send" disabled={!message.trim()} onClick={() => setMessage('')}><Send size={17} /></button></footer>
      <div className="omni-chat-actions"><button><Video size={15} /> Видеочат</button><button><CircleDollarSign size={15} /> Счёт Kaspi</button></div>
    </section>

    <aside className="omni-detail-pane">
      <div className="omni-detail-tabs"><button className={rightTab === 'notes' ? 'active' : ''} onClick={() => setRightTab('notes')}><StickyNote size={15} /> Заметки</button><button className={rightTab === 'calls' ? 'active' : ''} onClick={() => setRightTab('calls')}><Phone size={15} /> Звонки</button></div>
      {rightTab === 'notes' ? <><div className="omni-note-create"><input value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="Новая заметка" /><button onClick={saveNote}><Plus size={15} /></button></div><div className="omni-note-list">{notes.length ? notes.map((note, index) => <article key={`${note}-${index}`}><p>{note}</p><time>только что</time></article>) : <div className="omni-empty"><StickyNote size={28} /><strong>Нет заметок</strong><span>Добавьте первую заметку о клиенте</span></div>}</div></> : <div className="omni-empty"><Phone size={28} /><strong>Нет звонков</strong><span>История звонков появится здесь</span></div>}
      <div className="omni-client-card"><h3><UserRound size={16} /> Клиент</h3><dl><div><dt>Телефон</dt><dd>{selected.handle}</dd></div><div><dt>Email</dt><dd>{selected.channel === 'email' ? selected.handle : 'Не указан'}</dd></div><div><dt>Источник</dt><dd>{labels[selected.channel]}</dd></div></dl></div>
      <div className="omni-finance-card"><h3><CircleDollarSign size={16} /> Финансы</h3><div><span>Единый платёж</span><strong>{selected.amount.toLocaleString('ru-RU')} ₸</strong></div><div><span>Ежемесячный</span><strong>0 ₸/м</strong></div><div className="total"><span>Общая сумма</span><strong>{selected.amount.toLocaleString('ru-RU')} ₸</strong></div></div>
      <div className="omni-stage-block"><label>Этап<button>{selected.stage}<ChevronDown size={15} /></button></label><label>Воронка<button>Лечение позвоночника<ChevronDown size={15} /></button></label></div>
      <button className="omni-files"><Archive size={15} /> Показать файлы</button>
      <div className="omni-auto-save"><Clock3 size={14} /> Изменения сохраняются автоматически</div>
    </aside>
  </div>;
}
