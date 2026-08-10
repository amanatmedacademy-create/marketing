import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, CheckCircle2, LoaderCircle, MessageCircle, PhoneCall, Send, X } from 'lucide-react';
import {
  createChatThread,
  fetchChatMessages,
  fetchChatWorkspace,
  markChatThreadRead,
  sendChatMessage,
  type ChatMessage,
  type ChatThread,
} from '../services/callCenterChat';
import { createDealWorkspaceActivity } from '../services/dealWorkspace';
import { marketingApi, type MarketingCall } from '../services/api';
import '../embedded-communications.css';

export type CustomerCommunicationMode = 'chat' | 'call';

export type CustomerCommunicationContext = {
  mode: CustomerCommunicationMode;
  phone: string;
  name: string;
  dealId: string;
};

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits;
}

function displayPhone(value: string): string {
  const digits = normalizePhone(value);
  if (digits.length !== 11 || !digits.startsWith('7')) return value;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

function samePhone(left?: string | null, right?: string | null): boolean {
  const a = normalizePhone(left || '');
  const b = normalizePhone(right || '');
  return Boolean(a && b && (a === b || a.slice(-10) === b.slice(-10)));
}

function messageTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ru-KZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : value;
}

function duration(seconds: number): string {
  const value = Math.max(0, Number(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function EmbeddedChat({ context }: { context: CustomerCommunicationContext }) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadMessages = async (nextThread: ChatThread) => {
    setThread(nextThread);
    const rows = await fetchChatMessages(nextThread.id);
    setMessages(rows);
    await markChatThreadRead(nextThread.id).catch(() => undefined);
  };

  useEffect(() => {
    let active = true;
    setThread(null);
    setMessages([]);
    setLoading(true);
    setError('');
    fetchChatWorkspace()
      .then(async (workspace) => {
        if (!active) return;
        const found = workspace.threads.find((item) => samePhone(item.phone || item.contact?.phone, context.phone));
        if (found) await loadMessages(found);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Не удалось открыть чат'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [context.phone]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      let activeThread = thread;
      if (!activeThread) {
        activeThread = await createChatThread({ title: context.name, phone: context.phone, channel: 'WHATSAPP' });
        setThread(activeThread);
      }
      const saved = await sendChatMessage(activeThread.id, body, 'Оператор');
      setMessages((current) => [...current, saved]);
      setText('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };

  return <div className="embedded-communication-content">
    {loading && <div className="embedded-communication-state"><LoaderCircle className="spin"/> Загружаем переписку…</div>}
    {!loading && <>
      <div className="embedded-chat-messages">
        {!messages.length && <div className="embedded-communication-empty">
          <MessageCircle/><strong>{thread ? 'Сообщений пока нет' : 'Диалог ещё не создан'}</strong>
          <span>Первое сообщение создаст внутренний диалог с этим клиентом.</span>
        </div>}
        {messages.map((message) => <article key={message.id} className={`embedded-chat-message ${message.direction === 'OUTBOUND' ? 'outbound' : 'inbound'}`}>
          <header><strong>{message.senderName || (message.direction === 'OUTBOUND' ? 'Оператор' : context.name)}</strong><time>{messageTime(message.sentAt)}</time></header>
          <p>{message.body || message.attachmentName || 'Вложение'}</p>
          <footer>{message.status || 'Отправлено'}</footer>
        </article>)}
      </div>
      <form className="embedded-chat-compose" onSubmit={(event) => void send(event)}>
        <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишите сообщение клиенту…" onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}/>
        <button type="submit" disabled={!text.trim() || sending}>{sending ? <LoaderCircle className="spin"/> : <Send/>}<span>Отправить</span></button>
      </form>
    </>}
    {error && <div className="embedded-communication-error">{error}</div>}
  </div>;
}

function EmbeddedCalls({ context }: { context: CustomerCommunicationContext }) {
  const [calls, setCalls] = useState<MarketingCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [note, setNote] = useState('Связаться с клиентом');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setCalls([]);
    setLoading(true);
    setError('');
    marketingApi.calls({ limit: 500 })
      .then((rows) => {
        if (!active) return;
        setCalls(rows.filter((call) => samePhone(call.client_phone, context.phone)));
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Не удалось загрузить звонки'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [context.phone]);

  const schedule = async (event: FormEvent) => {
    event.preventDefault();
    if (!context.dealId || !note.trim() || saving) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await createDealWorkspaceActivity(context.dealId, {
        type: 'task',
        body: note.trim(),
        dueAt: dueAt || null,
      });
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось запланировать звонок');
    } finally {
      setSaving(false);
    }
  };

  return <div className="embedded-communication-content">
    <form className="embedded-call-scheduler" onSubmit={(event) => void schedule(event)}>
      <div><PhoneCall/><span><strong>Внутренняя телефония</strong><small>История клиента и задача оператору</small></span></div>
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Цель звонка"/>
      <label><CalendarClock/><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
      <button type="submit" disabled={saving || !context.dealId || !note.trim()}>{saving ? <LoaderCircle className="spin"/> : saved ? <CheckCircle2/> : <PhoneCall/>}<span>{saved ? 'Запланировано' : 'Запланировать'}</span></button>
    </form>

    <div className="embedded-call-list">
      <header><strong>История звонков</strong><span>{calls.length}</span></header>
      {loading && <div className="embedded-communication-state"><LoaderCircle className="spin"/> Загружаем звонки…</div>}
      {!loading && !calls.length && <div className="embedded-communication-empty"><PhoneCall/><strong>Звонков пока нет</strong><span>После звонка запись и результат появятся здесь.</span></div>}
      {calls.map((call) => <article key={call.id}>
        <div><strong>{call.operator_name || 'Оператор не назначен'}</strong><time>{messageTime(call.started_at)}</time></div>
        <p>{call.summary || call.call_result || call.next_action || 'Результат не заполнен'}</p>
        <footer><span>{duration(call.duration_seconds)}</span><b>{call.call_status || 'Без статуса'}</b></footer>
        {call.recording_url && <audio controls preload="none" src={call.recording_url}/>} 
      </article>)}
    </div>
    {error && <div className="embedded-communication-error">{error}</div>}
  </div>;
}

export default function CustomerCommunicationDrawer({ context, onClose }: { context: CustomerCommunicationContext | null; onClose: () => void }) {
  const [mode, setMode] = useState<CustomerCommunicationMode>('chat');

  useEffect(() => {
    if (context) setMode(context.mode);
  }, [context]);

  useEffect(() => {
    if (!context) return;
    document.body.classList.add('embedded-communication-open');
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      document.body.classList.remove('embedded-communication-open');
    };
  }, [context, onClose]);

  const title = useMemo(() => mode === 'chat' ? 'Чат с клиентом' : 'Звонки клиента', [mode]);
  if (!context || typeof document === 'undefined') return null;
  const activeContext = { ...context, mode };

  return createPortal(
    <div className="embedded-communication-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="embedded-communication-backdrop" aria-label="Закрыть" onClick={onClose}/>
      <section className="embedded-communication-panel">
        <header>
          <div className={`embedded-communication-icon ${mode}`}><span>{mode === 'chat' ? <MessageCircle/> : <PhoneCall/>}</span></div>
          <div><small>CRM · {mode === 'chat' ? 'ВНУТРЕННИЙ ЧАТ' : 'ТЕЛЕФОНИЯ'}</small><h2>{title}</h2><p>{context.name} · {displayPhone(context.phone)}</p></div>
          <button type="button" onClick={onClose} aria-label="Закрыть"><X/></button>
        </header>
        <nav>
          <button type="button" className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')}><MessageCircle/> Чат</button>
          <button type="button" className={mode === 'call' ? 'active' : ''} onClick={() => setMode('call')}><PhoneCall/> Звонки</button>
        </nav>
        {mode === 'chat' ? <EmbeddedChat context={activeContext}/> : <EmbeddedCalls context={activeContext}/>} 
      </section>
    </div>,
    document.body,
  );
}
