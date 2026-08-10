import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, Clock3,
  ExternalLink, History, Link2, LoaderCircle, Mail, MessageCircle, MessageSquareText,
  NotebookPen, Phone, PhoneCall, Save, Send, SquareCheckBig, UserRound, X
} from 'lucide-react';
import CustomerCommunicationDrawer, { type CustomerCommunicationContext } from './CustomerCommunicationDrawer';
import {
  createDealWorkspaceActivity,
  fetchDealWorkspace,
  updateDealWorkspaceActivity,
  type DealWorkspaceActivityType,
  type DealWorkspacePayload,
} from '../services/dealWorkspace';
import {
  moveFunnelDeal,
  updateFunnelDeal,
  type FunnelDeal,
  type FunnelDealInput,
  type FunnelPipeline,
  type FunnelUser,
} from '../services/salesFunnel';
import '../deal-workspace.css';

export const OPEN_DEAL_WORKSPACE_EVENT = 'amanat:open-deal-workspace';

type WorkspaceEventDetail = {
  deal: FunnelDeal;
  pipeline: FunnelPipeline;
  users: FunnelUser[];
};

type WorkspaceTab = 'general' | 'messages' | 'calls' | 'tasks' | 'history' | 'links';
type ComposerMode = 'comment' | 'task' | 'note';

type TimelineItem = {
  id: string;
  kind: 'activity' | 'message' | 'call' | 'stage';
  at: string;
  title: string;
  body?: string;
  author?: string;
  direction?: string;
  activityId?: string;
  activityType?: string;
  completed?: boolean;
  dueAt?: string;
  recordingUrl?: string;
};

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('ru-KZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const PRIORITY_LABEL: Record<FunnelDeal['priority'], string> = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', URGENT: 'Срочный' };

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function safeDate(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? dateTime.format(parsed) : '—';
}

function draftFromDeal(deal: FunnelDeal): FunnelDealInput {
  return {
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    marketingLeadId: deal.marketingLeadId || null,
    fullName: deal.fullName,
    phone: deal.phone || '',
    email: deal.email || '',
    source: deal.source,
    priority: deal.priority,
    managerUserId: deal.managerUserId || null,
    diagnostUserId: deal.diagnostUserId || null,
    description: deal.description || '',
    amount: deal.amount,
    paid: deal.paid,
    lostReason: deal.lostReason || '',
    nextAction: deal.nextAction || '',
    nextActionAt: deal.nextActionAt ? deal.nextActionAt.slice(0, 16) : null,
  };
}

function DealWorkspaceSkeleton() {
  return <div className="deal-workspace-skeleton" aria-label="Загрузка карточки сделки">
    <div className="skeleton-line wide"/><div className="skeleton-line medium"/>
    <div className="skeleton-stages">{Array.from({ length: 6 }, (_, index) => <span key={index}/>)}</div>
    <div className="skeleton-grid"><aside>{Array.from({ length: 8 }, (_, index) => <span key={index}/>)}</aside><main>{Array.from({ length: 5 }, (_, index) => <article key={index}/>)}</main></div>
  </div>;
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <div className="deal-workspace-empty"><MessageSquareText/><strong>{title}</strong><span>{text}</span></div>;
}

export default function DealWorkspaceHost() {
  const [context, setContext] = useState<WorkspaceEventDetail | null>(null);
  const [deal, setDeal] = useState<FunnelDeal | null>(null);
  const [draft, setDraft] = useState<FunnelDealInput | null>(null);
  const [data, setData] = useState<DealWorkspacePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<WorkspaceTab>('general');
  const [composerMode, setComposerMode] = useState<ComposerMode>('comment');
  const [composerText, setComposerText] = useState('');
  const [composerDueAt, setComposerDueAt] = useState('');
  const [posting, setPosting] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [communication, setCommunication] = useState<CustomerCommunicationContext | null>(null);

  const close = useCallback((fromPopState = false) => {
    setCommunication(null);
    setContext(null); setDeal(null); setDraft(null); setData(null); setError(''); setTab('general');
    document.body.classList.remove('deal-workspace-open');
    if (!fromPopState && window.location.pathname.includes('/pipeline/deal/')) {
      window.history.pushState({}, '', '/pipeline');
    }
    requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
  }, [scrollY]);

  const load = useCallback(async (dealId: string) => {
    setLoading(true); setError('');
    try { setData(await fetchDealWorkspace(dealId)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить рабочую карточку'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceEventDetail>).detail;
      if (!detail?.deal || !detail?.pipeline) return;
      setScrollY(window.scrollY);
      setContext(detail); setDeal(detail.deal); setDraft(draftFromDeal(detail.deal)); setTab('general');
      document.body.classList.add('deal-workspace-open');
      window.history.pushState({ dealWorkspace: true, dealId: detail.deal.id }, '', `/pipeline/deal/${detail.deal.id}`);
      void load(detail.deal.id);
    };
    const pop = () => { if (context) close(true); };
    window.addEventListener(OPEN_DEAL_WORKSPACE_EVENT, open);
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener(OPEN_DEAL_WORKSPACE_EVENT, open); window.removeEventListener('popstate', pop); };
  }, [close, context, load]);

  useEffect(() => {
    if (!context || communication) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [close, communication, context]);

  const usersById = useMemo(() => new Map([
    ...(context?.users || []).map((user) => [user.id, user.fullName] as const),
    ...(data?.users || []).map((user) => [user.id, user.fullName] as const),
  ]), [context?.users, data?.users]);
  const stagesById = useMemo(() => new Map((context?.pipeline.stages || []).map((stage) => [stage.id, stage])), [context?.pipeline.stages]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!data) return [];
    const items: TimelineItem[] = [];
    for (const item of data.activities) items.push({
      id: `activity-${item.id}`, kind: 'activity', at: item.createdAt,
      title: item.type === 'task' ? 'Задача' : item.type === 'note' ? 'Дело' : 'Комментарий',
      body: item.body, author: item.actorUserId ? usersById.get(item.actorUserId) : undefined,
      activityId: item.id, activityType: item.type, completed: Boolean(item.completedAt), dueAt: item.dueAt,
    });
    for (const item of data.messages) items.push({
      id: `message-${item.id}`, kind: 'message', at: item.sentAt,
      title: item.direction === 'inbound' ? 'Входящее сообщение' : 'Исходящее сообщение',
      body: item.body || item.attachmentName, author: item.senderName, direction: item.direction,
    });
    for (const item of data.calls) items.push({
      id: `call-${item.id}`, kind: 'call', at: item.startedAt,
      title: item.scheduledAt ? 'Запланированный звонок' : 'Звонок',
      body: item.summary || item.result || item.nextAction || `${item.durationSeconds} сек.`,
      author: item.operatorName, recordingUrl: item.recordingUrl,
    });
    for (const item of data.stageEvents) items.push({
      id: `stage-${item.id}`, kind: 'stage', at: item.createdAt,
      title: 'Стадия изменена',
      body: `${item.fromStageId ? stagesById.get(item.fromStageId)?.name || 'Предыдущая стадия' : 'Создание'} → ${stagesById.get(item.toStageId)?.name || 'Новая стадия'}${item.reason ? ` · ${item.reason}` : ''}`,
      author: item.actorUserId ? usersById.get(item.actorUserId) : undefined,
    });
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [data, stagesById, usersById]);

  const visibleTimeline = useMemo(() => timeline.filter((item) => {
    if (tab === 'messages') return item.kind === 'message';
    if (tab === 'calls') return item.kind === 'call';
    if (tab === 'tasks') return item.kind === 'activity' && item.activityType === 'task';
    if (tab === 'history') return item.kind === 'stage' || item.kind === 'activity';
    return true;
  }), [tab, timeline]);

  if (!context || !deal || !draft) return null;
  const pipeline = context.pipeline;
  const currentStage = pipeline.stages.find((stage) => stage.id === deal.stageId);
  const managerName = usersById.get(deal.managerUserId || '') || 'Не назначен';
  const diagnostName = usersById.get(deal.diagnostUserId || '') || 'Не назначен';
  const openCommunication = (mode: 'chat' | 'call') => {
    if (!deal.phone) return;
    setCommunication({ mode, phone: deal.phone, name: deal.fullName, dealId: deal.id });
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const updated = await updateFunnelDeal(deal.id, draft);
      const next = { ...deal, ...updated, ...draft } as FunnelDeal;
      setDeal(next); setDraft(draftFromDeal(next));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось сохранить сделку'); }
    finally { setSaving(false); }
  };

  const changeStage = async (stageId: string) => {
    if (stageId === deal.stageId) return;
    setSaving(true); setError('');
    try {
      const updated = await moveFunnelDeal(deal.id, { pipelineId: pipeline.id, stageId, position: Date.now() });
      setDeal({ ...deal, ...updated, stageId }); setDraft((current) => current ? { ...current, stageId } : current);
      await load(deal.id);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось изменить стадию'); }
    finally { setSaving(false); }
  };

  const postActivity = async (event: FormEvent) => {
    event.preventDefault();
    if (!composerText.trim()) return;
    setPosting(true); setError('');
    try {
      await createDealWorkspaceActivity(deal.id, { type: composerMode as DealWorkspaceActivityType, body: composerText.trim(), dueAt: composerMode === 'task' ? composerDueAt || null : null });
      setComposerText(''); setComposerDueAt(''); await load(deal.id);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось добавить активность'); }
    finally { setPosting(false); }
  };

  const toggleTask = async (activityId: string, completed: boolean) => {
    try { await updateDealWorkspaceActivity(deal.id, activityId, { completed: !completed }); await load(deal.id); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось обновить задачу'); }
  };

  return <>
    <div className="deal-workspace-layer" role="dialog" aria-modal="true" aria-label={`Сделка ${deal.fullName}`}>
      <button className="deal-workspace-backdrop" type="button" aria-label="Закрыть" onClick={() => close()}/>
      <section className="deal-workspace-panel">
        <header className="deal-workspace-header">
          <button className="deal-workspace-close" type="button" onClick={() => close()}><ArrowLeft/><span>К воронке</span></button>
          <div className="deal-workspace-identity"><span>{initials(deal.fullName)}</span><div><small>CRM-СДЕЛКА · {pipeline.name}</small><h1>{deal.fullName}</h1><p>{deal.phone || deal.email || 'Контакт не указан'}</p></div></div>
          <div className="deal-workspace-header-actions">
            {deal.phone && <button type="button" title="Звонки клиента" onClick={() => openCommunication('call')}><Phone/></button>}
            {deal.phone && <button type="button" title="Чат с клиентом" onClick={() => openCommunication('chat')}><MessageCircle/></button>}
            {deal.email && <a href={`mailto:${deal.email}`} title="Написать email"><Mail/></a>}
            <button type="button" className="workspace-save" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin"/> : <Save/>}<span>Сохранить</span></button>
            <button type="button" className="icon-close" onClick={() => close()}><X/></button>
          </div>
        </header>

        <div className="deal-workspace-stage-ribbon" aria-label="Стадии воронки">
          {pipeline.stages.map((stage, index) => <button key={stage.id} type="button" disabled={saving} className={`${stage.id === deal.stageId ? 'active' : ''} ${stage.stageType}`} style={{ '--stage-color': stage.color } as React.CSSProperties} onClick={() => void changeStage(stage.id)}>
            <span>{index + 1}</span><b>{stage.name}</b><small>{stage.stageType === 'open' ? `${stage.probability}%` : stage.stageType === 'won' ? 'Успех' : 'Потеря'}</small>{index < pipeline.stages.length - 1 && <ChevronRight/>}
          </button>)}
        </div>

        {error && <div className="deal-workspace-error"><span>{error}</span><button type="button" onClick={() => setError('')}><X/></button></div>}

        <div className="deal-workspace-body">
          <aside className="deal-workspace-details">
            <div className="deal-workspace-summary">
              <div><small>Стадия</small><strong style={{ color: currentStage?.color }}>{currentStage?.name || '—'}</strong></div>
              <div><small>Сумма</small><strong>{money.format(Number(draft.amount || 0))}</strong></div>
              <div><small>Статус</small><strong>{deal.paid ? 'Оплачено' : deal.status === 'won' ? 'Выиграно' : deal.status === 'lost' ? 'Потеряно' : 'В работе'}</strong></div>
            </div>

            <section className="deal-workspace-field-section"><header><div><UserRound/><span>Клиент и сделка</span></div><small>Изменения сохраняются кнопкой сверху</small></header>
              <div className="deal-workspace-fields">
                <label className="wide"><span>Имя клиента</span><input value={draft.fullName || ''} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}/></label>
                <label><span>Телефон</span><input value={draft.phone || ''} onChange={(event) => setDraft({ ...draft, phone: event.target.value })}/></label>
                <label><span>Email</span><input type="email" value={draft.email || ''} onChange={(event) => setDraft({ ...draft, email: event.target.value })}/></label>
                <label><span>Источник</span><input value={draft.source || ''} onChange={(event) => setDraft({ ...draft, source: event.target.value })}/></label>
                <label><span>Приоритет</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as FunnelDeal['priority'] })}>{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>Менеджер</span><select value={draft.managerUserId || ''} onChange={(event) => setDraft({ ...draft, managerUserId: event.target.value || null })}><option value="">Не назначен</option>{context.users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
                <label><span>Диагност</span><select value={draft.diagnostUserId || ''} onChange={(event) => setDraft({ ...draft, diagnostUserId: event.target.value || null })}><option value="">Не назначен</option>{context.users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
                <label><span>Сумма, ₸</span><input type="number" min="0" step="1000" value={draft.amount || 0} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })}/></label>
                <label className="checkbox"><input type="checkbox" checked={draft.paid === true} onChange={(event) => setDraft({ ...draft, paid: event.target.checked })}/><span>Оплата получена</span></label>
                <label className="wide"><span>Потребность / комментарий</span><textarea rows={4} value={draft.description || ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
                <label><span>Следующее действие</span><input value={draft.nextAction || ''} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })}/></label>
                <label><span>Срок действия</span><input type="datetime-local" value={draft.nextActionAt || ''} onChange={(event) => setDraft({ ...draft, nextActionAt: event.target.value || null })}/></label>
                {(currentStage?.stageType === 'lost' || deal.status === 'lost') && <label className="wide"><span>Причина потери</span><textarea rows={2} value={draft.lostReason || ''} onChange={(event) => setDraft({ ...draft, lostReason: event.target.value })}/></label>}
              </div>
            </section>

            <section className="deal-workspace-relations"><header><Link2/><span>Связи</span></header>
              <div><span>Маркетинговый лид</span><strong>{deal.marketingLeadId ? 'Связан' : 'Нет связи'}</strong></div>
              <div><span>Менеджер</span><strong>{managerName}</strong></div>
              <div><span>Диагност</span><strong>{diagnostName}</strong></div>
              <div><span>Создано</span><strong>{safeDate(deal.createdAt)}</strong></div>
              <div><span>На стадии с</span><strong>{safeDate(deal.stageEnteredAt)}</strong></div>
            </section>
          </aside>

          <main className="deal-workspace-feed">
            <nav className="deal-workspace-tabs">
              {([
                ['general', 'Общее', NotebookPen], ['messages', 'Переписка', MessageCircle], ['calls', 'Звонки', PhoneCall],
                ['tasks', 'Задачи', SquareCheckBig], ['history', 'История', History], ['links', 'Связи', Link2],
              ] as const).map(([value, label, Icon]) => <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon/><span>{label}</span></button>)}
            </nav>

            {tab !== 'links' && <form className="deal-workspace-composer" onSubmit={(event) => void postActivity(event)}>
              <div className="composer-modes">
                <button type="button" className={composerMode === 'note' ? 'active' : ''} onClick={() => setComposerMode('note')}><NotebookPen/> Дело</button>
                <button type="button" className={composerMode === 'comment' ? 'active' : ''} onClick={() => setComposerMode('comment')}><MessageSquareText/> Комментарий</button>
                <button type="button" className={composerMode === 'task' ? 'active' : ''} onClick={() => setComposerMode('task')}><SquareCheckBig/> Задача</button>
                {deal.phone && <button type="button" onClick={() => openCommunication('call')}><PhoneCall/> Звонок</button>}
                {deal.phone && <button type="button" onClick={() => openCommunication('chat')}><Send/> Сообщение</button>}
              </div>
              <textarea rows={3} value={composerText} onChange={(event) => setComposerText(event.target.value)} placeholder={composerMode === 'task' ? 'Что нужно сделать?' : composerMode === 'note' ? 'Зафиксировать дело или результат…' : 'Оставить внутренний комментарий…'}/>
              <footer>{composerMode === 'task' ? <label><CalendarClock/><input type="datetime-local" value={composerDueAt} onChange={(event) => setComposerDueAt(event.target.value)}/></label> : <span/>}<button type="submit" disabled={posting || !composerText.trim()}>{posting ? <LoaderCircle className="spin"/> : <Send/>} Добавить</button></footer>
            </form>}

            {loading && <DealWorkspaceSkeleton/>}
            {!loading && tab === 'links' && <div className="deal-workspace-links">
              <article><MessageCircle/><div><strong>Диалоги</strong><span>{data?.conversations.length || 0} связанных разговоров</span></div><a href="/chat">Открыть чат <ExternalLink/></a></article>
              <article><PhoneCall/><div><strong>Звонки</strong><span>{data?.calls.length || 0} звонков по клиенту</span></div><a href="/calls">Открыть звонки <ExternalLink/></a></article>
              <article><UserRound/><div><strong>Маркетинговый лид</strong><span>{deal.marketingLeadId ? 'Профиль связан со сделкой' : 'Связанный лид не найден'}</span></div><a href="/leads">Открыть лиды <ExternalLink/></a></article>
            </div>}

            {!loading && tab !== 'links' && visibleTimeline.length === 0 && <EmptyPanel title="Событий пока нет" text="Комментарии, задачи, сообщения, звонки и переходы будут отображаться здесь."/>}
            {!loading && tab !== 'links' && visibleTimeline.length > 0 && <div className="deal-workspace-timeline">
              {visibleTimeline.map((item) => <article key={item.id} className={`${item.kind} ${item.completed ? 'completed' : ''}`}>
                <div className="timeline-icon">{item.kind === 'message' ? <MessageCircle/> : item.kind === 'call' ? <PhoneCall/> : item.kind === 'stage' ? <ChevronRight/> : item.activityType === 'task' ? <SquareCheckBig/> : <NotebookPen/>}</div>
                <div className="timeline-card"><header><div><strong>{item.title}</strong>{item.author && <span>{item.author}</span>}</div><time>{safeDate(item.at)}</time></header>
                  {item.body && <p>{item.body}</p>}
                  {item.dueAt && <div className="timeline-due"><Clock3/>Срок: {safeDate(item.dueAt)}</div>}
                  {item.recordingUrl && <a className="timeline-recording" href={item.recordingUrl} target="_blank" rel="noreferrer"><PhoneCall/> Прослушать запись</a>}
                  {item.activityType === 'task' && item.activityId && <footer><button type="button" onClick={() => void toggleTask(item.activityId!, Boolean(item.completed))}>{item.completed ? <><CheckCircle2/> Вернуть в работу</> : <><SquareCheckBig/> Выполнено</>}</button></footer>}
                </div>
              </article>)}
            </div>}
          </main>
        </div>
      </section>
    </div>
    <CustomerCommunicationDrawer context={communication} onClose={() => setCommunication(null)}/>
  </>;
}
