import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  createChatThread,
  fetchChatMessages,
  fetchChatWorkspace,
  fetchWhatsAppTemplates,
  getChatAttachmentUrl,
  markChatThreadRead,
  sendChatMessage,
  sendWhatsAppTemplate,
  updateChatThread,
  type ChatAttachmentInput,
  type ChatMessage,
  type ChatStatus,
  type ChatThread,
  type ChatUser,
  type WhatsAppTemplate
} from '../services/callCenterChat';
import '../call-center-chat.css';

const STATUS_LABELS: Record<ChatStatus, string> = { OPEN: 'Открыт', PENDING: 'Ожидает', CLOSED: 'Закрыт' };
const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', WEB: 'Сайт', PHONE: 'Телефон', OTHER: 'Другой'
};
const CHANNEL_SYMBOLS: Record<string, string> = {
  WHATSAPP: 'W', INSTAGRAM: 'I', WEB: 'WEB', PHONE: '☎', OTHER: '•'
};
const FUNNEL_STAGE_LABELS: Record<string, string> = {
  NEW: 'Новый', QUALIFICATION: 'Квалификация', APPOINTMENT: 'Запись',
  DIAGNOSTIC: 'Диагностика', COURSE: 'Курс оплачен', LOST: 'Потерян'
};
const QUICK_REPLIES = [
  'Здравствуйте! Чем могу помочь?',
  'Подскажите, пожалуйста, когда вам удобно созвониться?',
  'Отправила вам детали программы, посмотрите, пожалуйста.',
  'Ваша заявка принята, менеджер свяжется с вами.',
  'Передам информацию ответственному менеджеру.'
];
const LIVE_REFRESH_VISIBLE_MS = 2500;
const LIVE_REFRESH_HIDDEN_MS = 12000;

type ChannelFilter = 'ALL' | 'WHATSAPP' | 'INSTAGRAM' | 'WEB' | 'PHONE' | 'OTHER';
type MobilePanel = 'list' | 'chat' | 'crm';

type NewThreadDraft = {
  title: string;
  phone: string;
  channel: string;
  assignedUserId: string;
};

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('ru-KZ', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-KZ', { day: '2-digit', month: '2-digit' });
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-KZ', { dateStyle: 'short', timeStyle: 'short' }) : value;
}

function bytesLabel(value?: number): string {
  if (!value) return '';
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function outboundStatusLabel(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'READ') return '✓✓ Прочитано';
  if (normalized === 'DELIVERED') return '✓✓ Доставлено';
  if (normalized === 'FAILED') return 'Не доставлено';
  if (normalized === 'SENT') return '✓ Отправлено';
  return normalized || 'Отправлено';
}

function messagesAreEqual(current: ChatMessage[], next: ChatMessage[]): boolean {
  if (current.length !== next.length) return false;
  return current.every((message, index) => {
    const candidate = next[index];
    return candidate?.id === message.id
      && candidate.status === message.status
      && candidate.readAt === message.readAt
      && candidate.body === message.body
      && candidate.sentAt === message.sentAt;
  });
}

async function fileToAttachment(file: File): Promise<ChatAttachmentInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', base64, sizeBytes: file.size });
    };
    reader.readAsDataURL(file);
  });
}

function emptyThreadDraft(): NewThreadDraft {
  return { title: '', phone: '', channel: 'WHATSAPP', assignedUserId: '' };
}

export function CallCenterChatPage() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState<ChannelFilter>('ALL');
  const [status, setStatus] = useState<ChatStatus | ''>('');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<ChatAttachmentInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [newThread, setNewThread] = useState<NewThreadDraft>(emptyThreadDraft);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplate[]>([]);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('list');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef('');
  const liveRefreshInFlightRef = useRef(false);

  const selected = threads.find((thread) => thread.id === selectedId) ?? null;
  const selectedContact = selected?.contact;
  const activeUsers = useMemo(() => users.filter((user) => user.active), [users]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const workspace = await fetchChatWorkspace();
      setThreads(workspace.threads);
      setUsers(workspace.users);
      setSelectedId((current) => current && workspace.threads.some((thread) => thread.id === current)
        ? current
        : workspace.threads[0]?.id ?? '');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить колл-центр');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLive = useCallback(async () => {
    if (liveRefreshInFlightRef.current) return;
    liveRefreshInFlightRef.current = true;
    try {
      const workspace = await fetchChatWorkspace();
      const activeId = selectedIdRef.current;
      const activeThread = workspace.threads.find((thread) => thread.id === activeId);

      setThreads(workspace.threads);
      setUsers(workspace.users);
      setSelectedId((current) => current && workspace.threads.some((thread) => thread.id === current)
        ? current
        : workspace.threads[0]?.id ?? '');

      if (activeId && activeThread) {
        const nextMessages = await fetchChatMessages(activeId);
        setMessages((current) => messagesAreEqual(current, nextMessages) ? current : nextMessages);

        if (document.visibilityState === 'visible' && (activeThread.unreadCount ?? 0) > 0) {
          await markChatThreadRead(activeId).catch(() => undefined);
          setThreads((current) => current.map((thread) => thread.id === activeId
            ? { ...thread, unreadCount: 0 }
            : thread));
        }
      }
    } catch {
      // Временная ошибка фонового обновления не должна заменять рабочий чат экраном ошибки.
    } finally {
      liveRefreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    setActionError('');
    void Promise.all([fetchChatMessages(selectedId), markChatThreadRead(selectedId)])
      .then(([nextMessages]) => {
        if (cancelled) return;
        setMessages(nextMessages);
        setThreads((current) => current.map((thread) => thread.id === selectedId ? { ...thread, unreadCount: 0 } : thread));
      })
      .catch((nextError) => { if (!cancelled) setActionError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить сообщения'); })
      .finally(() => { if (!cancelled) setMessagesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const delay = document.visibilityState === 'visible' ? LIVE_REFRESH_VISIBLE_MS : LIVE_REFRESH_HIDDEN_MS;
      timer = window.setTimeout(() => {
        void refreshLive().finally(schedule);
      }, delay);
    };
    const wake = () => { void refreshLive(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
    };

    schedule();
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshLive]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (channel !== 'ALL' && thread.channel !== channel) return false;
      if (status && thread.status !== status) return false;
      if (!normalized) return true;
      return [
        thread.title,
        thread.phone,
        thread.channel,
        thread.contact?.fullName,
        thread.contact?.source,
        thread.contact?.firstMessage,
        thread.lastMessage?.body
      ].some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [channel, query, status, threads]);

  const unreadTotal = threads.reduce((sum, thread) => sum + (thread.unreadCount ?? 0), 0);
  const openTotal = threads.filter((thread) => thread.status === 'OPEN').length;
  const pendingTotal = threads.filter((thread) => thread.status === 'PENDING').length;

  useEffect(() => {
    const previous = document.title;
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Колл-центр · Amanat Marketing` : 'Колл-центр · Amanat Marketing';
    return () => { document.title = previous; };
  }, [unreadTotal]);

  const selectThread = (threadId: string) => {
    setSelectedId(threadId);
    setMobilePanel('chat');
    setTemplatesOpen(false);
    setWhatsappTemplates([]);
    setAttachment(null);
    setActionError('');
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || (!text.trim() && !attachment) || sending) return;
    setSending(true);
    setActionError('');
    try {
      const saved = await sendChatMessage(selected.id, text.trim(), 'Оператор', attachment ?? undefined);
      setMessages((current) => current.some((message) => message.id === saved.id) ? current : [...current, saved]);
      setThreads((current) => current.map((thread) => thread.id === selected.id
        ? { ...thread, lastMessageAt: saved.sentAt, lastMessage: saved, status: 'OPEN' as const }
        : thread));
      setText('');
      setAttachment(null);
      setTemplatesOpen(false);
      void refreshLive();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };

  const openTemplates = async () => {
    if (!selected) return;
    if (selected.channel !== 'WHATSAPP') {
      setTemplatesOpen((current) => !current);
      return;
    }
    if (templatesOpen) {
      setTemplatesOpen(false);
      return;
    }
    setTemplatesOpen(true);
    if (whatsappTemplates.length) return;
    setTemplateLoading(true);
    setActionError('');
    try {
      setWhatsappTemplates(await fetchWhatsAppTemplates(selected.id));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить WhatsApp-шаблоны');
    } finally {
      setTemplateLoading(false);
    }
  };

  const sendTemplate = async (template: WhatsAppTemplate) => {
    if (!selected || sending) return;
    const parameters: string[] = [];
    for (let index = 1; index <= template.parameterCount; index += 1) {
      const value = window.prompt(`Значение для {{${index}}} в шаблоне ${template.name}:`, '')?.trim() || '';
      if (!value) return;
      parameters.push(value);
    }
    setSending(true);
    setActionError('');
    try {
      const saved = await sendWhatsAppTemplate(selected.id, template, parameters, 'Оператор');
      setMessages((current) => current.some((message) => message.id === saved.id) ? current : [...current, saved]);
      setThreads((current) => current.map((thread) => thread.id === selected.id
        ? { ...thread, lastMessageAt: saved.sentAt, lastMessage: saved, status: 'OPEN' as const }
        : thread));
      setTemplatesOpen(false);
      void refreshLive();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось отправить WhatsApp-шаблон');
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (next: ChatStatus) => {
    if (!selected) return;
    setActionError('');
    try {
      const saved = await updateChatThread(selected.id, { status: next });
      setThreads((current) => current.map((thread) => thread.id === saved.id ? { ...thread, ...saved, contact: thread.contact, funnelLead: thread.funnelLead, assignedUser: thread.assignedUser, lastMessage: thread.lastMessage, unreadCount: thread.unreadCount } : thread));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось изменить статус');
    }
  };

  const changeAssignee = async (assignedUserId: string) => {
    if (!selected) return;
    setActionError('');
    try {
      const saved = await updateChatThread(selected.id, { assignedUserId: assignedUserId || null });
      const assignedUser = users.find((user) => user.id === assignedUserId);
      setThreads((current) => current.map((thread) => thread.id === saved.id
        ? { ...thread, ...saved, contact: thread.contact, funnelLead: thread.funnelLead, lastMessage: thread.lastMessage, unreadCount: thread.unreadCount, assignedUser }
        : thread));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось назначить сотрудника');
    }
  };

  const createThread = async (event: FormEvent) => {
    event.preventDefault();
    if (!newThread.title.trim() && !newThread.phone.trim()) return;
    setCreatingBusy(true);
    setActionError('');
    try {
      const saved = await createChatThread({
        channel: newThread.channel,
        title: newThread.title.trim() || undefined,
        phone: newThread.phone.trim() || undefined,
        assignedUserId: newThread.assignedUserId || undefined
      });
      await load();
      setSelectedId(saved.id);
      setCreating(false);
      setNewThread(emptyThreadDraft());
      setMobilePanel('chat');
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось создать диалог');
    } finally {
      setCreatingBusy(false);
    }
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setActionError('Максимальный размер вложения — 5 МБ');
      return;
    }
    setActionError('');
    try {
      setAttachment(await fileToAttachment(file));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось подготовить вложение');
    }
  };

  const makeAiDraft = () => {
    const name = selectedContact?.fullName?.split(/\s+/)[0] || selected?.title?.split(/\s+/)[0] || 'клиент';
    const lastInbound = [...messages].reverse().find((message) => message.direction === 'INBOUND');
    const sourceNote = selectedContact?.source ? ` Вы обращались через ${selectedContact.source}.` : '';
    const context = lastInbound?.body ? ` Я вижу ваше сообщение: «${lastInbound.body.slice(0, 120)}».` : '';
    setText(`Здравствуйте, ${name}.${context}${sourceNote} Подскажите, пожалуйста, когда вам удобно созвониться с менеджером, чтобы обсудить детали?`);
  };

  const contactPhone = (selectedContact?.phone || selected?.phone || '').replace(/\D/g, '');

  return <div className="stack callcenter-root">
    <div className="callcenter-heading">
      <div><span>Обработка лидов</span><h1>Колл-центр</h1><p>Входящие обращения из WhatsApp, Instagram, сайта и других подключённых каналов — как CRM-чат МИС.</p></div>
      <div className="callcenter-toolbar">
        <span className="inbox-unread-pill">{unreadTotal} непрочитано</span>
        <button className="button button-primary" type="button" onClick={() => { setCreating(true); setActionError(''); }}>+ Новый диалог</button>
      </div>
    </div>

    <section className={`inbox-workspace mobile-${mobilePanel}`}>
      <header className="inbox-workspace-header">
        <div><span>CRM · CALL CENTER</span><h2>Единый чат колл-центра</h2></div>
        <div className="inbox-header-stats"><span><b>{openTotal}</b> открытых</span><span><b>{pendingTotal}</b> ожидают</span><span><b>{unreadTotal}</b> непрочитано</span></div>
      </header>

      {actionError && <div className="inbox-inline-error">{actionError}<button type="button" onClick={() => setActionError('')}>×</button></div>}
      {loading && <div className="inbox-state">Загрузка колл-центра…</div>}
      {error !== null && <div className="inbox-state inbox-state-error">{error}<button className="button button-secondary" type="button" onClick={() => void load()}>Повторить</button></div>}

      {!loading && error === null && <main className="inbox-layout">
        <aside className="inbox-left">
          <div className="inbox-left-top">
            <label className="inbox-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по чатам" />{query && <button type="button" onClick={() => setQuery('')}>×</button>}</label>
            <div className="inbox-channel-tabs">
              {(['ALL', 'WHATSAPP', 'INSTAGRAM', 'WEB', 'PHONE'] as ChannelFilter[]).map((value) => <button type="button" key={value} className={channel === value ? 'active' : ''} onClick={() => setChannel(value)}>{value === 'ALL' ? 'Все' : CHANNEL_LABELS[value]}{value === 'ALL' && unreadTotal > 0 && <b>{unreadTotal}</b>}</button>)}
            </div>
            <label className="inbox-status-filter"><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value as ChatStatus | '')}><option value="">Все статусы</option><option value="OPEN">Открытые</option><option value="PENDING">Ожидают</option><option value="CLOSED">Закрытые</option></select></label>
          </div>
          <div className="inbox-thread-list">
            {filtered.map((thread) => {
              const name = thread.contact?.fullName || thread.title || thread.phone || 'Без имени';
              const preview = thread.lastMessage?.body || thread.contact?.firstMessage || 'Новый диалог';
              return <button type="button" className={`inbox-thread ${thread.id === selectedId ? 'active' : ''}`} key={thread.id} onClick={() => selectThread(thread.id)}>
                <span className={`inbox-channel-badge channel-${thread.channel.toLowerCase()}`}>{CHANNEL_SYMBOLS[thread.channel] || '•'}</span>
                <span className="inbox-thread-main"><strong>{name}</strong><small>{preview}</small><em>{thread.assignedUser?.fullName || 'Не назначен'} · {STATUS_LABELS[thread.status]}</em></span>
                <span className="inbox-thread-meta"><time>{formatTime(thread.lastMessageAt)}</time>{Boolean(thread.unreadCount) && <b>{thread.unreadCount}</b>}</span>
              </button>;
            })}
            {!filtered.length && <div className="inbox-empty">Диалогов по выбранным фильтрам нет</div>}
          </div>
        </aside>

        <section className="inbox-center">
          {selected ? <>
            <header className="inbox-contact-bar">
              <button className="inbox-mobile-back" type="button" onClick={() => setMobilePanel('list')}>‹</button>
              <span className="inbox-contact-avatar">{initials(selectedContact?.fullName || selected.title || selected.phone || '?')}</span>
              <div className="inbox-contact-title"><strong>{selectedContact?.fullName || selected.title || selected.phone || 'Диалог'}</strong><small>{CHANNEL_LABELS[selected.channel] || selected.channel} · {selected.phone || selectedContact?.phone || 'телефон не указан'}</small></div>
              <div className="inbox-contact-actions">
                <select value={selected.status} onChange={(event) => void changeStatus(event.target.value as ChatStatus)}><option value="OPEN">Открыт</option><option value="PENDING">Ожидает</option><option value="CLOSED">Закрыт</option></select>
                <button type="button" onClick={() => setMobilePanel('crm')}>CRM</button>
              </div>
            </header>

            <div className="inbox-messages">
              {messagesLoading && <div className="inbox-empty">Загрузка сообщений…</div>}
              {!messagesLoading && messages.map((message, index) => {
                const previous = messages[index - 1];
                const showDate = !previous || new Date(previous.sentAt).toDateString() !== new Date(message.sentAt).toDateString();
                return <div key={message.id} className="inbox-message-block">
                  {showDate && <div className="inbox-date-divider"><span>{new Date(message.sentAt).toLocaleDateString('ru-KZ', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>}
                  <article className={`inbox-message ${message.direction === 'OUTBOUND' ? 'outbound' : 'inbound'}`}>
                    <header><strong>{message.senderName || (message.direction === 'OUTBOUND' ? 'Оператор' : selectedContact?.fullName || 'Клиент')}</strong></header>
                    <p>{message.body}</p>
                    {message.hasAttachment && <a className="inbox-attachment" href={getChatAttachmentUrl(message.id)} target="_blank" rel="noreferrer"><span>📎</span><div><strong>{message.attachmentName || 'Вложение'}</strong><small>{message.attachmentMimeType || 'Файл'} {bytesLabel(message.attachmentSizeBytes)}</small></div></a>}
                    <footer><time>{formatMessageTime(message.sentAt)}</time><span>{message.direction === 'OUTBOUND' ? outboundStatusLabel(message.status) : message.readAt ? 'Прочитано' : 'Новое'}</span></footer>
                  </article>
                </div>;
              })}
              {!messagesLoading && !messages.length && <div className="inbox-empty">Сообщений пока нет</div>}
              <div ref={messagesEndRef} />
            </div>

            <form className="inbox-compose" onSubmit={(event) => void send(event)}>
              <div className="inbox-quick-replies">{QUICK_REPLIES.slice(0, 3).map((reply) => <button type="button" key={reply} onClick={() => setText(reply)}>{reply}</button>)}</div>
              {selected.channel === 'WHATSAPP' && <small>Если клиент не писал последние 24 часа, отправьте одобренный шаблон через кнопку ▤.</small>}
              {attachment && <div className="inbox-attachment-draft"><span>📎</span><div><strong>{attachment.name}</strong><small>{attachment.mimeType} · {bytesLabel(attachment.sizeBytes)}</small></div><button type="button" onClick={() => setAttachment(null)}>×</button></div>}
              <div className="inbox-input-row">
                <input ref={fileInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.docx" onChange={(event) => void chooseFile(event)} />
                <button className="inbox-icon-button" type="button" onClick={() => fileInputRef.current?.click()} title="Прикрепить файл">📎</button>
                <div className="inbox-template-wrap"><button className="inbox-icon-button" type="button" onClick={() => void openTemplates()} title={selected.channel === 'WHATSAPP' ? 'Одобренные WhatsApp-шаблоны' : 'Шаблоны'}>▤</button>{templatesOpen && <div className="inbox-template-menu">{selected.channel === 'WHATSAPP' ? <>{templateLoading && <span>Загрузка шаблонов…</span>}{!templateLoading && !whatsappTemplates.length && <span>Одобренных шаблонов нет</span>}{whatsappTemplates.map((template) => <button type="button" key={`${template.name}:${template.language}`} onClick={() => void sendTemplate(template)}><strong>{template.name}</strong><small>{template.language} · {template.category || 'template'}</small><span>{template.body}</span></button>)}</> : QUICK_REPLIES.map((reply) => <button type="button" key={reply} onClick={() => { setText(reply); setTemplatesOpen(false); }}>{reply}</button>)}</div>}</div>
                <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишите сообщение." rows={1} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                <button className="inbox-ai-button" type="button" onClick={makeAiDraft} title="Подготовить ответ по контексту">AI</button>
                <button className="inbox-send-button" disabled={sending || (!text.trim() && !attachment)}>{sending ? '…' : '➤'}</button>
              </div>
            </form>
          </> : <div className="inbox-empty inbox-empty-main">Выберите диалог</div>}
        </section>

        <aside className="inbox-right">
          <header className="inbox-crm-mobile-head"><button type="button" onClick={() => setMobilePanel('chat')}>‹ Чат</button><strong>CRM-карточка</strong></header>
          {selected ? <>
            <section className="inbox-crm-profile">
              <span className="inbox-crm-avatar">{initials(selectedContact?.fullName || selected.title || '?')}</span>
              <h3>{selectedContact?.fullName || selected.title || 'Контакт не привязан'}</h3>
              <p>{selectedContact?.phone || selected.phone || 'Телефон не указан'}</p>
              <div><a href={`tel:${contactPhone}`}>Позвонить</a><a href={`https://wa.me/${contactPhone}`} target="_blank" rel="noreferrer">WhatsApp</a></div>
            </section>

            <section className="inbox-crm-section"><header><h4>Ответственный</h4></header><label><span>Сотрудник</span><select value={selected.assignedUserId || ''} onChange={(event) => void changeAssignee(event.target.value)}><option value="">Не назначен</option>{activeUsers.map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></label>{selected.assignedUser && <small>{selected.assignedUser.role}</small>}</section>

            <section className="inbox-crm-section"><header><h4>Контекст лида</h4></header><dl><div><dt>Источник</dt><dd>{selectedContact?.source || 'Не указан'}</dd></div><div><dt>UTM source</dt><dd>{selectedContact?.utmSource || 'Не указан'}</dd></div><div><dt>Первое сообщение</dt><dd>{selectedContact?.firstMessage || 'Не сохранено'}</dd></div><div><dt>Стадия (лиды)</dt><dd>{selectedContact?.stage || 'Не указана'}</dd></div></dl></section>

            <section className="inbox-crm-section"><header><h4>Воронка продаж</h4>{selected.funnelLead && <a href="/pipeline">Открыть воронку</a>}</header>{selected.funnelLead ? <article className="inbox-funnel-card"><strong>{FUNNEL_STAGE_LABELS[selected.funnelLead.stage] || selected.funnelLead.stage}</strong><span>{selected.funnelLead.source}</span>{selected.funnelLead.amount > 0 && <b>{money.format(selected.funnelLead.amount)}</b>}</article> : <div className="inbox-crm-empty">Лид ещё не в воронке</div>}<a className="inbox-crm-action" href="/pipeline">+ Открыть воронку продаж</a></section>

            <section className="inbox-crm-section"><header><h4>Быстрые действия</h4></header><div className="inbox-crm-buttons"><a href="/leads">База лидов</a><a href="/pipeline">Воронка продаж</a><a href="/calls">Звонки</a></div></section>
          </> : <div className="inbox-empty">Выберите диалог</div>}
        </aside>
      </main>}
    </section>

    {creating && <div className="inbox-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !creatingBusy) setCreating(false); }}>
      <form className="inbox-modal" onSubmit={(event) => void createThread(event)}>
        <header><div><span>КОЛЛ-ЦЕНТР</span><h2>Новый диалог</h2></div><button type="button" onClick={() => setCreating(false)}>×</button></header>
        <div className="inbox-modal-body">
          <label><span>Имя лида</span><input value={newThread.title} onChange={(event) => setNewThread((current) => ({ ...current, title: event.target.value }))} placeholder="Имя или тема обращения" /></label>
          <label><span>Телефон</span><input value={newThread.phone} onChange={(event) => setNewThread((current) => ({ ...current, phone: event.target.value }))} placeholder="+7 700 000 00 00" /></label>
          <label><span>Канал</span><select value={newThread.channel} onChange={(event) => setNewThread((current) => ({ ...current, channel: event.target.value }))}>{Object.entries(CHANNEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Ответственный</span><select value={newThread.assignedUserId} onChange={(event) => setNewThread((current) => ({ ...current, assignedUserId: event.target.value }))}><option value="">Не назначен</option>{activeUsers.map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></label>
        </div>
        {actionError && <div className="inbox-inline-error">{actionError}</div>}
        <footer><button type="button" className="button button-secondary" disabled={creatingBusy} onClick={() => setCreating(false)}>Отмена</button><button className="button button-primary" disabled={creatingBusy}>{creatingBusy ? 'Создание…' : 'Создать диалог'}</button></footer>
      </form>
    </div>}
  </div>;
}