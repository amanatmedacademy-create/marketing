import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  Cable,
  Database,
  MessageSquare,
  MoreHorizontal,
  PhoneCall,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../components/AuthGate';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type AssistantResponse = {
  answer: string;
  model?: string;
  generatedAt?: string;
};

const uid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const now = () => new Date().toISOString();

function loadSessions(storageKey: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}

function createSession(): ChatSession {
  const createdAt = now();
  return { id: uid(), title: 'Новый чат', createdAt, updatedAt: createdAt, messages: [] };
}

function messageTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function sessionDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return messageTime(value);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function titleFromQuestion(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Новый чат';
  return clean.length > 44 ? `${clean.slice(0, 44).trim()}…` : clean;
}

function AssistantText({ content }: { content: string }) {
  const lines = content.split('\n');
  return <div className="intelligence-answer-text">
    {lines.map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return <div className="intelligence-spacer" key={`space-${index}`} />;
      if (/^#{1,3}\s/.test(trimmed)) return <h3 key={`h-${index}`}>{trimmed.replace(/^#{1,3}\s*/, '')}</h3>;
      if (/^(\d+\.|[-•])\s/.test(trimmed)) return <div className="intelligence-bullet" key={`b-${index}`}><span>•</span><p>{trimmed.replace(/^(\d+\.|[-•])\s*/, '')}</p></div>;
      return <p key={`p-${index}`}>{line}</p>;
    })}
  </div>;
}

const quickPrompts = [
  'Проведи полный аудит IMDS Marketing и назови критические проблемы.',
  'Почему могла снизиться эффективность рекламы за последний период?',
  'Проверь CRM: где мы теряем лиды и что исправить первым?',
  'Проверь звонки и скорость обработки лидов.',
  'Проверь интеграции и качество данных, влияющее на аналитику.',
];

const intelligenceCss = `
.intelligence-page{--ii-bg:#07111d;--ii-panel:#0d1827;--ii-panel-2:#111d2f;--ii-border:rgba(148,163,184,.15);--ii-text:#eef4ff;--ii-muted:#8ea0ba;--ii-accent:#6d5dfc;--ii-accent-2:#2f7df4;--ii-good:#2dd4bf;--ii-warn:#f59e0b;--ii-danger:#fb7185;display:grid;grid-template-columns:300px minmax(0,1fr);height:calc(100vh - 116px);min-height:650px;border:1px solid var(--ii-border);border-radius:22px;overflow:hidden;background:radial-gradient(circle at 78% 6%,rgba(109,93,252,.14),transparent 33%),var(--ii-bg);color:var(--ii-text);box-shadow:0 24px 80px rgba(2,8,23,.26)}
[data-theme="light"] .intelligence-page{--ii-bg:#f5f8fc;--ii-panel:#ffffff;--ii-panel-2:#f1f5fb;--ii-border:rgba(15,23,42,.1);--ii-text:#0f172a;--ii-muted:#64748b;box-shadow:0 24px 70px rgba(15,23,42,.10)}
.intelligence-sidebar{display:flex;flex-direction:column;min-width:0;background:linear-gradient(180deg,rgba(14,24,40,.98),rgba(8,17,29,.98));border-right:1px solid var(--ii-border);padding:20px 14px 14px}
[data-theme="light"] .intelligence-sidebar{background:linear-gradient(180deg,#fff,#f5f8fc)}
.intelligence-brand{display:flex;align-items:center;gap:11px;padding:2px 7px 18px}.intelligence-brand-mark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#765cf7,#2b8bf2);box-shadow:0 10px 28px rgba(77,101,245,.3)}.intelligence-brand h2{font-size:16px;line-height:1.2;margin:0}.intelligence-brand p{margin:3px 0 0;color:var(--ii-muted);font-size:11px}
.intelligence-new-chat{height:42px;border:1px solid rgba(109,93,252,.35);border-radius:11px;background:linear-gradient(135deg,rgba(109,93,252,.18),rgba(47,125,244,.12));color:var(--ii-text);font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}.intelligence-new-chat:hover{border-color:rgba(109,93,252,.7)}
.intelligence-history-label{font-size:10px;font-weight:800;letter-spacing:.1em;color:var(--ii-muted);padding:20px 9px 8px;text-transform:uppercase}.intelligence-history{flex:1;overflow:auto;display:flex;flex-direction:column;gap:4px;padding-right:2px}.intelligence-chat-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:7px;width:100%;min-height:52px;padding:8px 8px;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--ii-text);text-align:left;cursor:pointer}.intelligence-chat-row:hover,.intelligence-chat-row.active{background:rgba(109,93,252,.10);border-color:rgba(109,93,252,.18)}.intelligence-chat-row.active{background:linear-gradient(135deg,rgba(109,93,252,.18),rgba(47,125,244,.09))}.intelligence-chat-row>span:first-child{width:28px;height:28px;border-radius:8px;background:rgba(148,163,184,.08);display:grid;place-items:center;color:#9dafff}.intelligence-chat-row strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.intelligence-chat-row small{display:block;color:var(--ii-muted);font-size:10px;margin-top:3px}.intelligence-row-actions{display:flex;align-items:center;gap:2px}.intelligence-row-actions button{border:0;background:transparent;color:var(--ii-muted);width:27px;height:27px;border-radius:7px;display:grid;place-items:center;cursor:pointer}.intelligence-row-actions button:hover{background:rgba(251,113,133,.12);color:var(--ii-danger)}
.intelligence-sidebar-foot{border-top:1px solid var(--ii-border);padding:13px 7px 3px;margin-top:10px}.intelligence-user{display:flex;align-items:center;gap:9px}.intelligence-avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;background:linear-gradient(135deg,#765cf7,#2b8bf2)}.intelligence-user strong{display:block;font-size:11px}.intelligence-user small{display:block;color:var(--ii-muted);font-size:9px;margin-top:2px}
.intelligence-main{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;min-width:0;background:linear-gradient(180deg,rgba(8,17,29,.25),rgba(5,12,22,.55))}[data-theme="light"] .intelligence-main{background:linear-gradient(180deg,#fbfdff,#f5f8fc)}
.intelligence-top{display:flex;justify-content:space-between;align-items:center;padding:16px 22px 12px;border-bottom:1px solid var(--ii-border)}.intelligence-title{display:flex;align-items:center;gap:10px}.intelligence-title span{width:32px;height:32px;border-radius:10px;background:rgba(109,93,252,.14);display:grid;place-items:center;color:#9b8cff}.intelligence-title h1{margin:0;font-size:15px}.intelligence-title p{margin:3px 0 0;color:var(--ii-muted);font-size:10px}.intelligence-live{display:flex;align-items:center;gap:6px;color:var(--ii-muted);font-size:10px}.intelligence-live i{width:7px;height:7px;border-radius:50%;background:var(--ii-good);box-shadow:0 0 0 4px rgba(45,212,191,.1)}
.intelligence-context{display:grid;grid-template-columns:repeat(6,minmax(90px,1fr));gap:8px;padding:12px 22px}.intelligence-context-card{min-width:0;border:1px solid var(--ii-border);border-radius:12px;padding:10px;background:rgba(15,29,47,.55)}[data-theme="light"] .intelligence-context-card{background:#fff}.intelligence-context-card div{display:flex;align-items:center;gap:6px;color:var(--ii-muted);font-size:9px}.intelligence-context-card svg{color:#8095ff}.intelligence-context-card strong{display:block;font-size:11px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.intelligence-context-card small{display:block;color:var(--ii-good);font-size:9px;margin-top:2px}
.intelligence-messages{overflow:auto;padding:18px 22px 30px;scroll-behavior:smooth}.intelligence-welcome{max-width:780px;margin:7vh auto 0;text-align:center}.intelligence-welcome-icon{width:58px;height:58px;margin:0 auto 16px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#765cf7,#2b8bf2);box-shadow:0 16px 50px rgba(77,101,245,.28)}.intelligence-welcome h2{font-size:25px;margin:0}.intelligence-welcome>p{color:var(--ii-muted);font-size:13px;line-height:1.65;max-width:620px;margin:10px auto 22px}.intelligence-prompts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.intelligence-prompt{border:1px solid var(--ii-border);border-radius:12px;padding:12px;background:rgba(15,29,47,.5);color:var(--ii-text);text-align:left;font-size:11px;line-height:1.45;cursor:pointer}.intelligence-prompt:hover{border-color:rgba(109,93,252,.5);background:rgba(109,93,252,.09)}[data-theme="light"] .intelligence-prompt{background:#fff}
.intelligence-message{max-width:900px;margin:0 auto 22px}.intelligence-message.user{display:flex;justify-content:flex-end}.intelligence-user-bubble{max-width:72%;background:linear-gradient(135deg,#4338ca,#3159ca);border:1px solid rgba(139,150,255,.34);border-radius:16px 16px 4px 16px;padding:12px 14px;color:#fff;box-shadow:0 12px 34px rgba(49,70,180,.18)}.intelligence-user-bubble p{margin:0;font-size:12px;line-height:1.55;white-space:pre-wrap}.intelligence-user-bubble small{display:block;text-align:right;font-size:9px;opacity:.65;margin-top:7px}
.intelligence-assistant{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px}.intelligence-assistant-avatar{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(135deg,#765cf7,#2b8bf2);box-shadow:0 10px 26px rgba(77,101,245,.22)}.intelligence-assistant-card{border:1px solid var(--ii-border);border-radius:16px;background:rgba(13,24,39,.82);padding:15px 17px;box-shadow:0 14px 45px rgba(2,8,23,.12)}[data-theme="light"] .intelligence-assistant-card{background:#fff}.intelligence-answer-text{font-size:12px;line-height:1.65;color:var(--ii-text)}.intelligence-answer-text p{margin:0 0 8px}.intelligence-answer-text h3{font-size:13px;margin:15px 0 8px}.intelligence-spacer{height:5px}.intelligence-bullet{display:grid;grid-template-columns:12px minmax(0,1fr);gap:4px}.intelligence-bullet span{color:#8b7dff}.intelligence-bullet p{margin:0 0 6px}.intelligence-message-meta{color:var(--ii-muted);font-size:9px;margin-top:8px}.intelligence-loading{display:flex;gap:5px;align-items:center;height:21px}.intelligence-loading i{width:6px;height:6px;border-radius:50%;background:#8b7dff;animation:ii-pulse 1s infinite alternate}.intelligence-loading i:nth-child(2){animation-delay:.2s}.intelligence-loading i:nth-child(3){animation-delay:.4s}@keyframes ii-pulse{to{opacity:.25;transform:translateY(-3px)}}
.intelligence-composer-wrap{padding:12px 22px 18px;background:linear-gradient(180deg,transparent,var(--ii-bg) 30%)}[data-theme="light"] .intelligence-composer-wrap{background:linear-gradient(180deg,transparent,#f5f8fc 30%)}.intelligence-composer{max-width:930px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 42px;gap:8px;border:1px solid rgba(109,93,252,.25);border-radius:15px;background:rgba(13,24,39,.92);padding:7px 7px 7px 13px;box-shadow:0 13px 40px rgba(2,8,23,.20)}[data-theme="light"] .intelligence-composer{background:#fff}.intelligence-composer textarea{border:0;outline:0;resize:none;min-height:42px;max-height:120px;background:transparent;color:var(--ii-text);font:inherit;font-size:12px;line-height:1.5;padding:10px 0}.intelligence-composer textarea::placeholder{color:var(--ii-muted)}.intelligence-send{border:0;border-radius:11px;background:linear-gradient(135deg,#765cf7,#2b8bf2);color:#fff;display:grid;place-items:center;cursor:pointer;align-self:end;height:42px}.intelligence-send:disabled{opacity:.45;cursor:not-allowed}.intelligence-hint{max-width:930px;margin:7px auto 0;color:var(--ii-muted);font-size:9px;text-align:center}
@media(max-width:1100px){.intelligence-page{grid-template-columns:240px minmax(0,1fr)}.intelligence-context{grid-template-columns:repeat(3,1fr)}}
@media(max-width:800px){.intelligence-page{grid-template-columns:1fr;height:auto;min-height:calc(100vh - 105px)}.intelligence-sidebar{display:none}.intelligence-context{grid-template-columns:repeat(2,1fr);padding:10px 12px}.intelligence-top{padding:13px}.intelligence-messages{padding:15px 12px 24px}.intelligence-prompts{grid-template-columns:1fr}.intelligence-composer-wrap{padding:10px 12px 14px}.intelligence-user-bubble{max-width:88%}}
`;

export function MarketingAiPage() {
  const { user } = useAuth();
  const storageKey = useMemo(() => `imds_intelligence_chats:${user.companyId || 'default'}:${user.id}`, [user.companyId, user.id]);
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions(storageKey));
  const [activeId, setActiveId] = useState(() => loadSessions(storageKey)[0]?.id || '');
  const [composer, setComposer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = loadSessions(storageKey);
    setSessions(stored);
    setActiveId(stored[0]?.id || '');
  }, [storageKey]);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(sessions)); } catch { /* browser storage can be unavailable */ }
  }, [sessions, storageKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, sessions, loading]);

  const active = sessions.find((session) => session.id === activeId);
  const initials = (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  const newChat = () => {
    const session = createSession();
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    setComposer('');
    setError('');
  };

  const removeChat = (id: string) => {
    setSessions((current) => {
      const next = current.filter((session) => session.id !== id);
      if (activeId === id) setActiveId(next[0]?.id || '');
      return next;
    });
  };

  const ask = async (preset?: string) => {
    const question = (preset ?? composer).trim();
    if (!question || loading) return;
    setLoading(true);
    setError('');
    setComposer('');

    let target = active;
    if (!target) {
      target = createSession();
      setActiveId(target.id);
      setSessions((current) => [target as ChatSession, ...current]);
    }

    const targetId = target.id;
    const previous = target.messages.slice(-8);
    const userMessage: ChatMessage = { id: uid(), role: 'user', content: question, createdAt: now() };
    const nextTitle = target.messages.length === 0 ? titleFromQuestion(question) : target.title;

    setSessions((current) => current.map((session) => session.id === targetId
      ? { ...session, title: nextTitle, updatedAt: userMessage.createdAt, messages: [...session.messages, userMessage] }
      : session));

    const dialogue = previous
      .map((message) => `${message.role === 'user' ? 'Пользователь' : 'IMDS Intelligence'}: ${message.content}`)
      .join('\n')
      .slice(-2500);
    const contextualQuestion = dialogue
      ? `Продолжи текущий диалог, учитывая контекст предыдущих сообщений. Не повторяй уже сказанное без необходимости.\n\n${dialogue}\n\nНовый вопрос пользователя: ${question}`.slice(-3900)
      : question;

    try {
      const response = await fetch('/api/assistant/marketing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: contextualQuestion }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<AssistantResponse> & { error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error || `AI вернул HTTP ${response.status}`);
      const assistantMessage: ChatMessage = { id: uid(), role: 'assistant', content: payload.answer, createdAt: payload.generatedAt || now() };
      setSessions((current) => current.map((session) => session.id === targetId
        ? { ...session, updatedAt: assistantMessage.createdAt, messages: [...session.messages, assistantMessage] }
        : session).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'IMDS Intelligence временно недоступен');
    } finally {
      setLoading(false);
    }
  };

  const contextCards = [
    { icon: UsersRound, label: 'CRM', detail: 'Лиды и воронка' },
    { icon: BarChart3, label: 'Ads', detail: 'Meta / реклама' },
    { icon: PhoneCall, label: 'Calls', detail: 'Телефония' },
    { icon: Activity, label: 'Analytics', detail: 'Метрики' },
    { icon: Cable, label: 'Integrations', detail: 'Синхронизации' },
    { icon: ShieldCheck, label: 'Audit', detail: 'Системный аудит' },
  ];

  return <>
    <style>{intelligenceCss}</style>
    <div className="intelligence-page">
      <aside className="intelligence-sidebar">
        <div className="intelligence-brand">
          <div className="intelligence-brand-mark"><Sparkles size={19} /></div>
          <div><h2>IMDS Intelligence</h2><p>AI Marketing Assistant</p></div>
        </div>
        <button type="button" className="intelligence-new-chat" onClick={newChat}><Plus size={15} />Новый чат</button>
        <div className="intelligence-history-label">История</div>
        <div className="intelligence-history">
          {sessions.length === 0 && <div style={{ padding: '10px', color: 'var(--ii-muted)', fontSize: 11 }}>История появится после первого запроса.</div>}
          {sessions.map((session) => <button key={session.id} type="button" className={`intelligence-chat-row ${session.id === activeId ? 'active' : ''}`} onClick={() => { setActiveId(session.id); setError(''); }}>
            <span><MessageSquare size={13} /></span>
            <span><strong>{session.title}</strong><small>{sessionDate(session.updatedAt)}</small></span>
            <span className="intelligence-row-actions">
              <button type="button" title="Удалить чат" aria-label="Удалить чат" onClick={(event) => { event.stopPropagation(); removeChat(session.id); }}><Trash2 size={13} /></button>
            </span>
          </button>)}
        </div>
        <div className="intelligence-sidebar-foot">
          <div className="intelligence-user"><div className="intelligence-avatar">{initials}</div><div><strong>{user.name || user.email}</strong><small>{user.jobTitle || user.role}</small></div></div>
        </div>
      </aside>

      <section className="intelligence-main">
        <header className="intelligence-top">
          <div className="intelligence-title"><span><Bot size={16} /></span><div><h1>{active?.title || 'IMDS Intelligence'}</h1><p>AI-ассистент по данным текущей клиники</p></div></div>
          <div className="intelligence-live"><i />Контекст IMDS подключён<MoreHorizontal size={16} /></div>
        </header>

        <div className="intelligence-context">
          {contextCards.map(({ icon: Icon, label, detail }) => <div className="intelligence-context-card" key={label}><div><Icon size={13} />{label}</div><strong>{detail}</strong><small>Доступно AI</small></div>)}
        </div>

        <div className="intelligence-messages" ref={scrollRef}>
          {!active?.messages.length && <div className="intelligence-welcome">
            <div className="intelligence-welcome-icon"><Sparkles size={25} /></div>
            <h2>Что проверить в IMDS Marketing?</h2>
            <p>Задавайте вопросы по маркетингу, CRM, рекламе, аналитике, интеграциям и работе системы. IMDS Intelligence использует только данные текущей клиники, доступные серверному AI-контексту.</p>
            <div className="intelligence-prompts">{quickPrompts.map((prompt) => <button type="button" className="intelligence-prompt" key={prompt} onClick={() => void ask(prompt)}>{prompt}</button>)}</div>
          </div>}

          {active?.messages.map((message) => message.role === 'user'
            ? <div className="intelligence-message user" key={message.id}><div className="intelligence-user-bubble"><p>{message.content}</p><small>{messageTime(message.createdAt)}</small></div></div>
            : <div className="intelligence-message" key={message.id}><div className="intelligence-assistant"><div className="intelligence-assistant-avatar"><Bot size={17} /></div><div><div className="intelligence-assistant-card"><AssistantText content={message.content} /></div><div className="intelligence-message-meta">IMDS Intelligence · {messageTime(message.createdAt)}</div></div></div></div>)}

          {loading && <div className="intelligence-message"><div className="intelligence-assistant"><div className="intelligence-assistant-avatar"><Bot size={17} /></div><div><div className="intelligence-assistant-card"><div className="intelligence-loading"><i /><i /><i /></div></div><div className="intelligence-message-meta">Анализирую данные текущей клиники…</div></div></div></div>}
          {error && <div className="intelligence-message"><div className="intelligence-assistant"><div className="intelligence-assistant-avatar"><Database size={17} /></div><div><div className="intelligence-assistant-card"><AssistantText content={`Не удалось выполнить запрос: ${error}`} /></div></div></div></div>}
        </div>

        <div className="intelligence-composer-wrap">
          <div className="intelligence-composer">
            <textarea rows={1} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Спросите про маркетинг, CRM, аналитику или аудит системы..." />
            <button type="button" className="intelligence-send" aria-label="Отправить" disabled={!composer.trim() || loading} onClick={() => void ask()}><Send size={17} /></button>
          </div>
          <div className="intelligence-hint">Enter — отправить · Shift+Enter — новая строка · история сохраняется для текущего пользователя и клиники в этом браузере</div>
        </div>
      </section>
    </div>
  </>;
}

export default MarketingAiPage;
