import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CheckCircle2, Clock3, FileText, LoaderCircle, MessageSquareText, Phone, Plus, RefreshCw } from 'lucide-react';
import { loadAppUser, type AppUser } from './services/auth';
import { marketingApi, type MarketingCall } from './services/api';
import { tasksApi, type WorkTask } from './services/tasks';
import { createDealWorkspaceActivity, fetchDealWorkspace, type DealWorkspaceActivity } from './services/dealWorkspace';
import './messaging-live-context.css';

type FunnelContact = { id: string; fullName: string; phone?: string; crmDealId?: string };

type ContactContext = {
  name: string;
  phone: string;
};

function normalizePhone(value?: string | null): string {
  let digits = (value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits;
}

function samePhone(left?: string | null, right?: string | null): boolean {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return Boolean(a && b && (a === b || a.slice(-10) === b.slice(-10)));
}

function formatDate(value?: string | null): string {
  if (!value) return 'Без срока';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-KZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : value;
}

function duration(seconds: number): string {
  const value = Math.max(0, Number(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function taskMatches(task: WorkTask, contact: FunnelContact | null, phone: string): boolean {
  const ids = [contact?.id, contact?.crmDealId, normalizePhone(phone)].filter(Boolean) as string[];
  if (task.linkId && ids.includes(task.linkId)) return true;
  const haystack = [task.linkLabel, task.title, task.description].filter(Boolean).join(' ').toLowerCase();
  const digits = normalizePhone(phone);
  return Boolean(digits && haystack.replace(/\D/g, '').includes(digits.slice(-10)));
}

function LiveContactPanel({ context }: { context: ContactContext }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [contact, setContact] = useState<FunnelContact | null>(null);
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [calls, setCalls] = useState<MarketingCall[]>([]);
  const [notes, setNotes] = useState<DealWorkspaceActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('Связаться с клиентом');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const currentUser = await loadAppUser();
      setUser(currentUser);
      const phone = normalizePhone(context.phone);
      const contactResponse = await fetch(`/api/funnel/contacts?q=${encodeURIComponent(phone || context.name)}`, { cache: 'no-store' });
      const contacts = contactResponse.ok ? await contactResponse.json() as FunnelContact[] : [];
      const matched = contacts.find((item) => samePhone(item.phone, context.phone)) || contacts[0] || null;
      setContact(matched);

      const [taskResponse, callResponse] = await Promise.all([
        tasksApi.list('all', ''),
        marketingApi.calls({ limit: 500 }),
      ]);
      setTasks(taskResponse.tasks.filter((task) => taskMatches(task, matched, context.phone)).slice(0, 5));
      setCalls(callResponse.filter((call) => samePhone(call.client_phone, context.phone)).sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()).slice(0, 5));

      if (matched?.crmDealId) {
        const workspace = await fetchDealWorkspace(matched.crmDealId);
        setNotes(workspace.activities.filter((item) => item.type === 'note').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5));
      } else {
        setNotes([]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить CRM-контекст');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [context.name, context.phone]);

  const createTask = async () => {
    if (!user || !taskTitle.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await tasksApi.create({
        title: taskTitle.trim(),
        description: `Клиент: ${context.name} · ${context.phone}`,
        priority: 'medium',
        assignmentMode: 'shared',
        workflowKey: 'call_center',
        targets: [{ targetType: 'user', targetValue: user.id, targetLabel: user.name || user.email || 'Текущий пользователь' }],
        linkType: contact?.crmDealId ? 'crm_deal' : contact?.id ? 'marketing_lead' : 'customer',
        linkId: contact?.crmDealId || contact?.id || normalizePhone(context.phone),
        linkLabel: `${context.name} · ${context.phone}`,
      });
      setTaskTitle('Связаться с клиентом');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать задачу');
    } finally {
      setBusy(false);
    }
  };

  const createNote = async () => {
    if (!contact?.crmDealId || !note.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await createDealWorkspaceActivity(contact.crmDealId, { type: 'note', body: note.trim() });
      setNote('');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить заметку');
    } finally {
      setBusy(false);
    }
  };

  const openTasks = useMemo(() => tasks.filter((task) => !['done', 'cancelled'].includes(task.status)), [tasks]);

  return <div className="messaging-live-context">
    <header className="messaging-live-context__head">
      <div><strong>Живой CRM-контекст</strong><small>Tasks · Calls · Notes</small></div>
      <button type="button" onClick={() => void load()} disabled={loading} title="Обновить"><RefreshCw size={14} className={loading ? 'spin' : ''}/></button>
    </header>

    {error && <div className="messaging-live-context__error">{error}</div>}
    {loading && !tasks.length && !calls.length && !notes.length ? <div className="messaging-live-context__loading"><LoaderCircle className="spin" size={16}/> Загружаем данные клиента…</div> : <>
      <section className="messaging-live-block">
        <header><div><CheckCircle2 size={15}/><strong>Задачи</strong></div><a href="/tasks">Все</a></header>
        <div className="messaging-live-create"><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Новая задача"/><button type="button" onClick={() => void createTask()} disabled={busy || !taskTitle.trim()}><Plus size={14}/></button></div>
        <div className="messaging-live-list">
          {openTasks.length ? openTasks.map((task) => <a key={task.id} href="/tasks" className="messaging-live-row"><span className={`messaging-live-dot priority-${task.priority}`}/><div><strong>{task.title}</strong><small><Clock3 size={11}/>{formatDate(task.dueAt)}</small></div><b>{task.status === 'in_progress' ? 'В работе' : task.status === 'review' ? 'Проверка' : 'Открыта'}</b></a>) : <div className="messaging-live-empty">Открытых задач для клиента нет.</div>}
        </div>
      </section>

      <section className="messaging-live-block">
        <header><div><Phone size={15}/><strong>Последние звонки</strong></div><a href="/calls">Все</a></header>
        <div className="messaging-live-list">
          {calls.length ? calls.map((call) => <a key={call.id} href="/calls" className="messaging-live-row"><span className={`messaging-live-call ${call.call_status?.toLowerCase() || 'pending'}`}><Phone size={12}/></span><div><strong>{call.operator_name || 'Оператор не назначен'}</strong><small>{formatDate(call.started_at)} · {duration(call.duration_seconds)}</small><em>{call.summary || call.call_result || call.next_action || 'Результат не заполнен'}</em></div><b>{call.call_status || '—'}</b></a>) : <div className="messaging-live-empty">Звонков по этому номеру пока нет.</div>}
        </div>
      </section>

      <section className="messaging-live-block">
        <header><div><MessageSquareText size={15}/><strong>Заметки</strong></div>{contact?.crmDealId && <a href="/pipeline">Сделка</a>}</header>
        {contact?.crmDealId ? <>
          <div className="messaging-live-create messaging-live-create--note"><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Добавить заметку о клиенте…"/><button type="button" onClick={() => void createNote()} disabled={busy || !note.trim()}><Plus size={14}/></button></div>
          <div className="messaging-live-list">{notes.length ? notes.map((item) => <article key={item.id} className="messaging-live-note"><FileText size={13}/><div><p>{item.body}</p><small>{formatDate(item.createdAt)}</small></div></article>) : <div className="messaging-live-empty">Заметок пока нет.</div>}</div>
        </> : <div className="messaging-live-empty">CRM-сделка для этого контакта ещё не создана — заметки появятся после создания сделки.</div>}
      </section>
    </>}
  </div>;
}

let liveRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let currentContext = '';
let currentUser: AppUser | null = null;

function readContactContext(): ContactContext | null {
  const root = document.querySelector('.callcenter-root');
  const profile = root?.querySelector('.inbox-crm-profile');
  if (!profile) return null;
  const name = profile.querySelector('h3')?.textContent?.trim() || '';
  const phone = profile.querySelector('p')?.textContent?.trim() || '';
  if (!name || !phone || /не указан/i.test(phone)) return null;
  return { name, phone };
}

function ensureHost(): HTMLElement | null {
  const right = document.querySelector<HTMLElement>('.callcenter-root .inbox-right');
  if (!right) return null;
  let host = right.querySelector<HTMLElement>('[data-imds-messaging-live-context]');
  if (!host) {
    host = document.createElement('div');
    host.dataset.imdsMessagingLiveContext = '1';
    right.appendChild(host);
  }
  return host;
}

function applyMineFilter(): void {
  const root = document.querySelector<HTMLElement>('.callcenter-root');
  if (!root || root.dataset.messagingMine !== '1' || !currentUser) return;
  const userName = (currentUser.name || '').trim().toLowerCase();
  root.querySelectorAll<HTMLElement>('.inbox-thread').forEach((thread) => {
    const meta = thread.querySelector('.inbox-thread-main em')?.textContent?.toLowerCase() || '';
    thread.style.display = userName && meta.includes(userName) ? '' : 'none';
  });
}

function clearMineFilter(): void {
  const root = document.querySelector<HTMLElement>('.callcenter-root');
  if (!root) return;
  root.dataset.messagingMine = '0';
  root.querySelectorAll<HTMLElement>('.inbox-thread').forEach((thread) => { thread.style.display = ''; });
  root.querySelectorAll<HTMLButtonElement>('.inbox-queue-tabs button').forEach((button) => {
    if (button.textContent?.trim().startsWith('Мои')) button.classList.remove('active');
  });
}

function enhanceQueueButtons(): void {
  const root = document.querySelector<HTMLElement>('.callcenter-root');
  if (!root || root.dataset.messagingMineBound === '1') return;
  root.dataset.messagingMineBound = '1';
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.inbox-queue-tabs button') : null;
    if (!target) return;
    const label = target.textContent?.trim() || '';
    if (label.startsWith('Мои')) {
      event.preventDefault();
      event.stopPropagation();
      root.querySelectorAll<HTMLButtonElement>('.inbox-queue-tabs button').forEach((button) => button.classList.remove('active'));
      target.classList.add('active');
      root.dataset.messagingMine = '1';
      applyMineFilter();
      return;
    }
    clearMineFilter();
  }, true);
}

function mountLivePanel(): void {
  const context = readContactContext();
  const host = ensureHost();
  if (!context || !host) return;
  const key = `${context.name}|${normalizePhone(context.phone)}`;
  if (host !== mountedHost) {
    liveRoot?.unmount();
    liveRoot = createRoot(host);
    mountedHost = host;
    currentContext = '';
  }
  if (key !== currentContext) {
    currentContext = key;
    liveRoot?.render(<LiveContactPanel context={context}/>);
  }
}

function enhance(): void {
  enhanceQueueButtons();
  applyMineFilter();
  mountLivePanel();
}

if (typeof window !== 'undefined') {
  loadAppUser().then((user) => { currentUser = user; enhance(); }).catch(() => undefined);
  const observer = new MutationObserver(() => window.requestAnimationFrame(enhance));
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('focus', enhance);
}
