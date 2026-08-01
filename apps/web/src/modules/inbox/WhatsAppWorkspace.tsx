import { useEffect, useMemo, useState } from 'react';
import { Filter, MessageCircle, Paperclip, Search, Send } from 'lucide-react';
import {
  useSendWhatsAppMessage,
  useWhatsAppConversation,
  useWhatsAppConversations,
} from './useWhatsAppInbox';

const formatTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Almaty',
    }).format(new Date(value))
  : '';

export function WhatsAppWorkspace() {
  const conversations = useWhatsAppConversations();
  const sendMessage = useSendWhatsAppMessage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = conversations.data ?? [];
    if (!query) return source;
    return source.filter((item) =>
      `${item.contactName ?? ''} ${item.contactPhone}`.toLowerCase().includes(query),
    );
  }, [conversations.data, search]);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (!items.some((item) => item.id === selectedId)) setSelectedId(items[0].id);
  }, [items, selectedId]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const details = useWhatsAppConversation(selected?.id ?? null);

  const submit = () => {
    const value = text.trim();
    if (!selected || !value || sendMessage.isPending) return;
    sendMessage.mutate(
      { conversationId: selected.id, text: value },
      { onSuccess: () => setText('') },
    );
  };

  return (
    <div className="wa-workspace">
      <aside className="wa-sidebar">
        <header className="wa-sidebar-head">
          <h2>WhatsApp</h2>
          <div>
            <button aria-label="Поиск"><Search size={20} /></button>
            <button aria-label="Фильтр"><Filter size={20} /></button>
          </div>
        </header>

        <label className="wa-search-box">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск контакта" />
        </label>

        <div className="wa-conversation-list">
          {conversations.isLoading && <div className="wa-list-state">Загрузка диалогов…</div>}
          {conversations.isError && <div className="wa-list-state error">Не удалось загрузить WhatsApp</div>}
          {!conversations.isLoading && !conversations.isError && !items.length && (
            <div className="wa-empty-list">
              <MessageCircle size={40} strokeWidth={1.7} />
              <strong>Нет чатов WhatsApp</strong>
              <span>Чаты появятся когда клиенты напишут вам</span>
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              className={item.id === selectedId ? 'active' : ''}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="wa-contact-avatar"><MessageCircle size={17} /></span>
              <span className="wa-contact-copy">
                <strong>{item.contactName || item.contactPhone}</strong>
                <small>{item.messages[0]?.text || 'Вложение или системное сообщение'}</small>
              </span>
              <span className="wa-contact-meta">
                <time>{formatTime(item.lastMessageAt)}</time>
                {item.unreadCount > 0 && <b>{item.unreadCount}</b>}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="wa-chat-area">
        {!selected ? (
          <div className="wa-empty-chat">
            <span><MessageCircle size={37} /></span>
            <strong>WhatsApp Web</strong>
            <p>Нет активных чатов. Чаты появятся когда клиенты напишут вам.</p>
          </div>
        ) : (
          <>
            <header className="wa-chat-head">
              <span className="wa-contact-avatar"><MessageCircle size={17} /></span>
              <div>
                <strong>{selected.contactName || selected.contactPhone}</strong>
                <small>{selected.contactPhone}</small>
              </div>
            </header>
            <div className="wa-message-stream">
              {details.isLoading && <div className="wa-system-message">Загрузка переписки…</div>}
              {(details.data?.messages ?? []).map((message) => (
                <article key={message.id} className={message.direction === 'OUTBOUND' ? 'outgoing' : 'incoming'}>
                  <p>{message.text || 'Вложение'}</p>
                  <time>{formatTime(message.createdAt)}</time>
                </article>
              ))}
            </div>
            <footer className="wa-composer">
              <button aria-label="Вложение"><Paperclip size={18} /></button>
              <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишите сообщение…" />
              <button className="send" disabled={!text.trim() || sendMessage.isPending} onClick={submit}><Send size={18} /></button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
