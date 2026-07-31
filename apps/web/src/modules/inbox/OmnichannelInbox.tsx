import { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, CircleDollarSign, Clock3, FileText, Instagram, Mail, MessageCircle, MoreVertical, Paperclip, Phone, Plus, Search, Send, StickyNote, UserRound, Video } from 'lucide-react';
import {
  useSendWhatsAppMessage,
  useUpdateWhatsAppConversation,
  useWhatsAppConversation,
  useWhatsAppConversations,
  type WhatsAppMessage,
} from './useWhatsAppInbox';

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
  status?: 'OPEN' | 'PENDING' | 'CLOSED';
};

const demoConversations: Conversation[] = [
  { id: 'c2', channel: 'instagram', name: 'Марат С.', handle: '@marat.s', preview: 'Можно узнать цену курса?', time: '03:18', unread: 1, stage: 'В работе', amount: 25000 },
  { id: 'c3', channel: 'email', name: 'Ольга В.', handle: 'olga@example.com', preview: 'Результаты МРТ во вложении', time: 'Вчера', unread: 0, stage: 'Консультация', amount: 18000 },
];

const labels: Record<InboxChannel, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', email: 'Email' };
const icons = { whatsapp: MessageCircle, instagram: Instagram, email: Mail };
const fallbackWhatsApp: Conversation = {
  id: 'wa-fallback',
  channel: 'whatsapp',
  name: 'Нет активных диалогов',
  handle: 'Подключите канал WhatsApp',
  preview: 'Новые обращения появятся здесь автоматически',
  time: '',
  unread: 0,
  stage: 'Новый лид',
  amount: 0,
  status: 'OPEN',
};

const formatTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }).format(new Date(value))
  : '';

export function OmnichannelInbox({ initialChannel }: { initialChannel: InboxChannel }) {
  const [channel, setChannel] = useState<InboxChannel>(initialChannel);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [rightTab, setRightTab] = useState<'notes' | 'calls'>('notes');

  const whatsappList = useWhatsAppConversations();
  const sendWhatsApp = useSendWhatsAppMessage();
  const updateWhatsApp = useUpdateWhatsAppConversation();

  const whatsappConversations = useMemo<Conversation[]>(() => (whatsappList.data ?? []).map(item => ({
    id: item.id,
    channel: 'whatsapp',
    name: item.contactName || item.contactPhone,
    handle: item.contactPhone,
    preview: item.messages[0]?.text || 'Вложение или системное сообщение',
    time: formatTime(item.lastMessageAt),
    unread: item.unreadCount,
    stage: item.deal?.title || 'Без привязанной сделки',
    amount: Number(item.deal?.amount ?? 0),
    status: item.status,
  })), [whatsappList.data]);

  const visible = useMemo(() => {
    if (channel === 'whatsapp') return whatsappConversations.length ? whatsappConversations : [fallbackWhatsApp];
    return demoConversations.filter(item => item.channel === channel);
  }, [channel, whatsappConversations]);

  useEffect(() => {
    if (!visible.some(item => item.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [visible, selectedId]);

  const selected = visible.find(item => item.id === selectedId) ?? visible[0] ?? fallbackWhatsApp;
  const selectedIsLiveWhatsApp = channel === 'whatsapp' && selected.id !== fallbackWhatsApp.id;
  const details = useWhatsAppConversation(selectedIsLiveWhatsApp ? selected.id : null);
  const SelectedIcon = icons[selected.channel];

  const selectChannel = (next: InboxChannel) => {
    setChannel(next);
    setSelectedId(null);
  };

  const saveNote = () => {
    const value = noteDraft.trim();
    if (!value) return;
    setNotes(current => [...current, value]);
    setNoteDraft('');
  };

  const sendMessage = () => {
    const text = message.trim();
    if (!text || !selectedIsLiveWhatsApp || sendWhatsApp.isPending) return;
    sendWhatsApp.mutate({ conversationId: selected.id, text }, { onSuccess: () => setMessage('') });
  };

  const messages: WhatsAppMessage[] = selectedIsLiveWhatsApp ? details.data?.messages ?? [] : [];
  const channelConnected = details.data?.channel.status === 'CONNECTED';

  return <div className="omni-shell">
    <aside className="omni-list-pane">
      <div className="omni-channel-tabs">{(['whatsapp', 'instagram', 'email'] as InboxChannel[]).map(item => { const Icon = icons[item]; return <button key={item} className={channel === item ? 'active' : ''} onClick={() => selectChannel(item)}><Icon size={16} />{labels[item]}</button>; })}</div>
      <div className="omni-list-head"><div><h2>{labels[channel]}</h2><span>{channel === 'whatsapp' && whatsappList.isLoading ? 'Загрузка…' : `${visible.filter(item => item.id !== fallbackWhatsApp.id).length} диалог`}</span></div><button><MoreVertical size={17} /></button></div>
      <label className="omni-search"><Search size={15} /><input placeholder="Поиск контакта" /></label>
      <div className="omni-filters"><button className="active">Все</button><button>Новые</button><button>Без ответа</button></div>
      {channel === 'whatsapp' && whatsappList.isError && <div className="omni-api-error">Не удалось загрузить WhatsApp: {whatsappList.error.message}</div>}
      <div className="omni-conversations">{visible.map(item => { const Icon = icons[item.channel]; return <button className={selected.id === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedId(item.id)}><span className={`omni-avatar ${item.channel}`}><Icon size={17} /></span><span className="omni-conversation-copy"><strong>{item.name}</strong><small>{item.preview}</small></span><span className="omni-conversation-meta"><time>{item.time}</time>{item.unread > 0 && <b>{item.unread}</b>}</span></button>; })}</div>
    </aside>

    <section className="omni-chat-pane">
      <header className="omni-chat-head"><div className={`omni-avatar ${selected.channel}`}><SelectedIcon size={17} /></div><div><strong>{selected.name}</strong><span>{selected.handle}</span></div><label><Search size={15} /><input placeholder="Поиск" /></label><button><Plus size={15} /> Добавить задачу</button></header>
      <div className={`omni-channel-warning ${channelConnected ? 'connected' : ''}`}>Отправлять с: <strong>{labels[selected.channel]}</strong> · {channel === 'whatsapp' ? channelConnected ? 'канал подключён' : 'канал требует подключения аккаунта' : 'демо-режим'}</div>
      <div className="omni-messages"><span className="omni-day">Сегодня</span>{details.isLoading && selectedIsLiveWhatsApp && <div className="omni-system-message">Загрузка переписки…</div>}{selectedIsLiveWhatsApp ? messages.map(item => <div className={`omni-message ${item.direction === 'INBOUND' ? 'incoming' : 'outgoing'}`} key={item.id}><p>{item.text || 'Вложение'}</p><time>{formatTime(item.createdAt)} · {item.status.toLowerCase()}</time></div>) : <><div className="omni-system-message">{channel === 'whatsapp' ? 'Диалог появится после первого входящего сообщения' : 'Демонстрационный диалог'}</div>{selected.id !== fallbackWhatsApp.id && <div className="omni-message incoming"><p>{selected.preview}</p><time>{selected.time}</time></div>}</>}</div>
      <div className="omni-composer-warning">{channel === 'whatsapp' ? channelConnected ? 'Окно свободной переписки зависит от последнего сообщения клиента' : 'Подключите канал для отправки сообщений' : 'Backend этого канала будет подключён следующим этапом'}</div>
      <footer className="omni-composer"><button><Paperclip size={17} /></button><textarea value={message} onChange={event => setMessage(event.target.value)} placeholder={channel === 'email' ? 'Текст письма…' : 'Напишите сообщение…'} /><button className="omni-template"><FileText size={17} /></button><button className="omni-send" disabled={!message.trim() || !selectedIsLiveWhatsApp || sendWhatsApp.isPending} onClick={sendMessage}><Send size={17} /></button></footer>
      {sendWhatsApp.isError && <div className="omni-send-error">{sendWhatsApp.error.message}</div>}
      <div className="omni-chat-actions"><button><Video size={15} /> Видеочат</button><button><CircleDollarSign size={15} /> Счёт Kaspi</button>{selectedIsLiveWhatsApp && <button disabled={updateWhatsApp.isPending} onClick={() => updateWhatsApp.mutate({ conversationId: selected.id, status: selected.status === 'CLOSED' ? 'OPEN' : 'CLOSED' })}>{selected.status === 'CLOSED' ? 'Возобновить' : 'Закрыть диалог'}</button>}</div>
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
