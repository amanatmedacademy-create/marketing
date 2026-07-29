import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, MessageCircle, RefreshCw, Search, Send } from 'lucide-react';
import './marketing-chat.css';

type ChatMessage = {
  id: string;
  body: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sentAt: string;
};

type ChatThread = {
  id: string;
  title?: string | null;
  phone?: string | null;
  channel: string;
  status: 'OPEN' | 'CLOSED';
  unreadCount?: number;
  lastMessage?: ChatMessage | null;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Ошибка API: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export default function MarketingChatBox() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const selected = threads.find((thread) => thread.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) => [thread.title, thread.phone, thread.channel, thread.lastMessage?.body]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(needle)));
  }, [query, threads]);

  const loadThreads = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await requestJson<ChatThread[]>('/api/conversations');
      setThreads(next);
      setSelectedId((current) => current && next.some((thread) => thread.id === current) ? current : next[0]?.id ?? '');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить диалоги');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadThreads(); }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let active = true;
    setError('');
    void requestJson<ChatMessage[]>(`/api/conversations/${encodeURIComponent(selectedId)}/messages`)
      .then((next) => { if (active) setMessages(next); })
      .catch((nextError) => { if (active) setError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить сообщения'); });
    return () => { active = false; };
  }, [selectedId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !text.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const saved = await requestJson<ChatMessage>(`/api/conversations/${encodeURIComponent(selected.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text.trim() }),
      });
      setMessages((current) => [...current, saved]);
      setThreads((current) => current.map((thread) => thread.id === selected.id ? { ...thread, lastMessage: saved, status: 'OPEN' } : thread));
      setText('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };

  const closeThread = async () => {
    if (!selected) return;
    setError('');
    try {
      await requestJson(`/api/conversations/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CLOSED' }),
      });
      setThreads((current) => current.map((thread) => thread.id === selected.id ? { ...thread, status: 'CLOSED' } : thread));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Не удалось закрыть диалог');
    }
  };

  return <div className="marketing-chat-page">
    <header className="marketing-chat-title">
      <div><span>Communications</span><h1>IMDS Chat</h1><p>Единый чат пациентов из МИС внутри Marketing.</p></div>
      <button type="button" onClick={() => void loadThreads()}><RefreshCw size={17}/>Обновить</button>
    </header>

    <section className="marketing-chat-shell">
      <aside className="marketing-chat-list">
        <div className="marketing-chat-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск диалога" /></div>
        {loading && <div className="marketing-chat-state">Загрузка диалогов…</div>}
        {!loading && filtered.map((thread) => <button type="button" key={thread.id} className={thread.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(thread.id)}>
          <span className="marketing-chat-avatar">{initials(thread.title || thread.phone || '?')}</span>
          <span><strong>{thread.title || thread.phone || 'Без имени'}</strong><small>{thread.channel} · {thread.lastMessage?.body || 'Без сообщений'}</small></span>
          {thread.unreadCount ? <b>{thread.unreadCount}</b> : <i className={`status-${thread.status.toLowerCase()}`} />}
        </button>)}
        {!loading && !filtered.length && <div className="marketing-chat-state">Диалогов нет</div>}
      </aside>

      <main className="marketing-chat-conversation">
        {error && <div className="marketing-chat-error">{error}</div>}
        {selected ? <>
          <header><div><strong>{selected.title || selected.phone || 'Диалог'}</strong><small>{selected.channel} · {selected.status === 'OPEN' ? 'Открыт' : 'Закрыт'}</small></div><button type="button" onClick={() => void closeThread()}><Check size={16}/>Закрыть</button></header>
          <div className="marketing-chat-messages">
            {messages.map((message) => <article key={message.id} className={message.direction === 'OUTBOUND' ? 'outbound' : ''}><p>{message.body}</p><time>{new Date(message.sentAt).toLocaleTimeString('ru-KZ', { hour: '2-digit', minute: '2-digit' })}</time></article>)}
            {!messages.length && <div className="marketing-chat-empty"><MessageCircle size={34}/><strong>Сообщений пока нет</strong><span>Выберите диалог или дождитесь синхронизации с МИС.</span></div>}
          </div>
          <form className="marketing-chat-compose" onSubmit={(event) => void submit(event)}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Введите сообщение…" rows={2}/><button type="submit" disabled={sending || !text.trim()}><Send size={18}/></button></form>
        </> : <div className="marketing-chat-empty"><MessageCircle size={38}/><strong>Выберите диалог</strong><span>Здесь появится история переписки пациента.</span></div>}
      </main>
    </section>
  </div>;
}
