import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ChevronRight, Clock3, ExternalLink, History,
  Link2, ListChecks, LoaderCircle, MessageCircle, MessageSquareText, NotebookPen,
  PhoneCall, Save, Send, SquareCheckBig, UserRound, X
} from 'lucide-react';
import { useDealWorkspaceController } from './DealWorkspaceController';
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
} from '../services/salesFunnel';
import '../deal-workspace.css';

type WorkspaceTab = 'activity' | 'history' | 'links';
type ComposerMode = 'comment' | 'note';
type TimelineItem = {
  id: string;
  kind: 'activity' | 'message' | 'call' | 'stage';
  at: string;
  title: string;
  body?: string;
  author?: string;
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

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <div className="deal-workspace-empty"><MessageSquareText/><strong>{title}</strong><span>{text}</span></div>;
}

function contextHref(path: string, deal: FunnelDeal): string {
  const params = new URLSearchParams();
  params.set('deal_id', deal.id);
  if (deal.marketingLeadId) params.set('lead_id', deal.marketingLeadId);
  if (deal.phone) params.set('phone', deal.phone);
  return `${path}?${params.toString()}`;
}

export default function DealWorkspaceHost() {
  const { context, close: closeController } = useDealWorkspaceController();
  const [deal, setDeal] = useState<FunnelDeal | null>(null);
  const [draft, setDraft] = useState<FunnelDealInput | null>(null);
  const [data, setData] = useState<DealWorkspacePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<WorkspaceTab>('activity');
  const [composerMode, setComposerMode] = useState<ComposerMode>('comment');
  const [composerText, setComposerText] = useState('');
  const [posting, setPosting] = useState(false);
  const scrollYRef = useRef(0);

  const load = useCallback(async (dealId: string) => {
    setLoading(true);
    setError('');
    try { setData(await fetchDealWorkspace(dealId)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить рабочую карточку'); }
    finally { setLoading(false); }
  }, []);

  const close = useCallback((fromPopState = false) => {
    setDeal(null);
    setDraft(null);
    setData(null);
    setError('');
    setTab('activity');
    document.body.classList.remove('deal-workspace-open');
    closeController();
    if (!fromPopState && window.location.pathname.includes('/pipeline/deal/')) {
      window.history.pushState({}, '', '/pipeline');
    }
    requestAnimationFrame(() => window.scrollTo({ top: scrollYRef.current, behavior: 'instant' }));
  }, [closeController]);

  useEffect(() => {
    if (!context) return;
    scrollYRef.current = window.scrollY;
    setDeal(context.deal);
    setDraft(draftFromDeal(context.deal));
    setData(null);
    setError('');
    setTab('activity');
    document.body.classList.add('deal-workspace-open');
    const nextPath = `/pipeline/deal/${context.deal.id}`;
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ dealWorkspace: true, dealId: context.deal.id }, '', nextPath);
    }
    void load(context.deal.id);
  }, [context, load]);

  useEffect(() => {
    if (!context) return;
    const pop = () => close(true);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [close, context]);

  useEffect(() => {
    if (!context) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [close, context]);

  useEffect(() => () => document.body.classList.remove('deal-workspace-open'), []);

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
      title: item.type === 'task' ? 'Задача' : item.type === 'note' ? 'Заметка' : 'Комментарий',
      body: item.body, author: item.actorUserId ? usersById.get(item.actorUserId) : undefined,
      activityId: item.id, activityType: item.type, completed: Boolean(item.completedAt), dueAt: item.dueAt,
    });
    for (const item of data.messages) items.push({
      id: `message-${item.id}`, kind: 'message', at: item.sentAt,
      title: item.direction === 'inbound' ? 'Входящее сообщение' : 'Исходящее сообщение',
      body: item.body || item.attachmentName, author: item.senderName,
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
    if (tab === 'history') return item.kind === 'stage' || item.kind === 'activity';
    return true;
  }), [tab, timeline]);

  if (!context || !deal || !draft) return null;
  const pipeline = context.pipeline;
  const currentStage = pipeline.stages.find((stage) => stage.id === deal.stageId);
  const managerName = usersById.get(deal.managerUserId || '') || 'Не назначен';
  const diagnostName = usersById.get(deal.diagnostUserId || '') || 'Не назначен';
  const statusLabel = deal.paid ? 'Оплачено' : deal.status === 'won' ? 'Выиграно' : deal.status === 'lost' ? 'Потеряно' : 'В работе';

  const save = async () => {
    setSaving(true); setError('');
    try {
      const updated = await updateFunnelDeal(deal.id, draft);
      const next = { ...deal, ...updated, ...draft } as FunnelDeal;
      setDeal(next);
      setDraft(draftFromDeal(next));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось сохранить сделку'); }
    finally { setSaving(false); }
  };

  const changeStage = async (stageId: string) => {
    if (stageId === deal.stageId) return;
    setSaving(true); setError('');
    try {
      const updated = await moveFunnelDeal(deal.id, { pipelineId: pipeline.id, stageId, position: Date.now() });
      const next = { ...deal, ...updated, stageId } as FunnelDeal;
      setDeal(next);
      setDraft((current) => current ? { ...current, stageId } : current);
      await load(deal.id);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось изменить стадию'); }
    finally { setSaving(false); }
  };

  const postActivity = async (event: FormEvent) => {
    event.preventDefault();
    if (!composerText.trim()) return;
    setPosting(true); setError('');
    try {
      await createDealWorkspaceActivity(deal.id, {
        type: composerMode as DealWorkspaceActivityType,
        body: composerText.trim(),
        dueAt: null,
      });
      setComposerText('');
      await load(deal.id);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось добавить активность'); }
    finally { setPosting(false); }
  };

  const toggleLegacyTask = async (activityId: string, completed: boolean) => {
    try {
      await updateDealWorkspaceActivity(deal.id, activityId, { completed: !completed });
      await load(deal.id);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Не удалось обновить старую задачу'); }
  };

  return <>
    <div className="deal-workspace-layer deal-workspace-layer--friendly" role="dialog" aria-modal="true" aria-label={`Сделка ${deal.fullName}`}>
      <button className="deal-workspace-backdrop" type="button" aria-label="Закрыть" onClick={() => close()}/>
      <section className="deal-workspace-panel">
        <header className="deal-workspace-header deal-workspace-header--friendly">
          <button className="deal-workspace-close" type="button" onClick={() => close()}><ArrowLeft/><span>Сделки</span></button>
          <div className="deal-workspace-identity"><span>{initials(deal.fullName)}</span><div><small>{pipeline.name}</small><h1>{deal.fullName}</h1><p>{deal.phone || deal.email || 'Контакт не указан'}</p></div></div>
          <div className="deal-workspace-deal-value"><small>Сумма сделки</small><strong>{money.format(Number(draft.amount || 0))}</strong><span>{statusLabel}</span></div>
          <div className="deal-workspace-header-actions">
            <button type="button" className="workspace-save" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin"/> : <Save/>}<span>Сохранить</span></button>
            <button type="button" className="icon-close" onClick={() => close()}><X/></button>
          </div>
        </header>

        <div className="deal-workspace-quick-actions" aria-label="Основные действия">
          <a className={deal.phone ? '' : 'disabled'} href={deal.phone ? contextHref('/telephony', deal) : undefined}><PhoneCall/><span>Позвонить</span></a>
          <a className={deal.phone ? '' : 'disabled'} href={deal.phone ? contextHref('/chat', deal) : undefined}><MessageCircle/><span>Написать</span></a>
          <a href={contextHref('/tasks', deal)}><ListChecks/><span>Задача</span></a>
          <a href={contextHref('/schedule', deal)}><CalendarDays/><span>Записать</span></a>
        </div>

        <div className="deal-workspace-stage-ribbon" aria-label="Стадия сделки">
          {pipeline.stages.map((stage, index) => <button key={stage.id} type="button" disabled={saving} className={`${stage.id === deal.stageId ? 'active' : ''} ${stage.stageType}`} style={{ '--stage-color': stage.color } as React.CSSProperties} onClick={() => void changeStage(stage.id)}>
            <span>{index + 1}</span><b>{stage.name}</b><small>{stage.stageType === 'open' ? `${stage.probability}%` : stage.stageType === 'won' ? 'Успех' : 'Потеря'}</small>{index < pipeline.stages.length - 1 && <ChevronRight/>}
          </button>)}
        </div>

        {error && <div className="deal-workspace-error"><span>{error}</span><button type="button" onClick={() => setError('')}><X/></button></div>}

        <div className="deal-workspace-body deal-workspace-body--friendly">
          <aside className="deal-workspace-details">
            <div className="deal-workspace-summary deal-workspace-summary--friendly">
              <div><small>Стадия</small><strong style={{ color: currentStage?.color }}>{currentStage?.name || '—'}</strong></div>
              <div><small>Следующее действие</small><strong>{draft.nextAction || 'Не задано'}</strong><span>{safeDate(draft.nextActionAt || undefined)}</span></div>
            </div>

            <section className="deal-workspace-field-section"><header><div><UserRound/><span>Основное</span></div><small>Редактируйте только то, что нужно менеджеру</small></header>
              <div className="deal-workspace-fields">
                <label className="wide"><span>Имя клиента</span><input value={draft.fullName || ''} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}/></label>
                <label><span>Телефон</span><input value={draft.phone || ''} onChange={(event) => setDraft({ ...draft, phone: event.target.value })}/></label>
                <label><span>Email</span><input type="email" value={draft.email || ''} onChange={(event) => setDraft({ ...draft, email: event.target.value })}/></label>
                <label><span>Менеджер</span><select value={draft.managerUserId || ''} onChange={(event) => setDraft({ ...draft, managerUserId: event.target.value || null })}><option value="">Не назначен</option>{context.users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
                <label><span>Приоритет</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as FunnelDeal['priority'] })}>{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>Сумма, ₸</span><input type="number" min="0" step="1000" value={draft.amount || 0} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })}/></label>
                <label className="checkbox"><input type="checkbox" checked={draft.paid === true} onChange={(event) => setDraft({ ...draft, paid: event.target.checked })}/><span>Оплата получена</span></label>
                <label className="wide"><span>Потребность / комментарий</span><textarea rows={3} value={draft.description || ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
                <label><span>Следующее действие</span><input value={draft.nextAction || ''} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })}/></label>
                <label><span>Срок</span><input type="datetime-local" value={draft.nextActionAt || ''} onChange={(event) => setDraft({ ...draft, nextActionAt: event.target.value || null })}/></label>
                {(currentStage?.stageType === 'lost' || deal.status === 'lost') && <label className="wide"><span>Причина потери</span><textarea rows={2} value={draft.lostReason || ''} onChange={(event) => setDraft({ ...draft, lostReason: event.target.value })}/></label>}
              </div>
            </section>

            <details className="deal-workspace-more">
              <summary>Дополнительные данные</summary>
              <div className="deal-workspace-fields">
                <label><span>Источник</span><input value={draft.source || ''} onChange={(event) => setDraft({ ...draft, source: event.target.value })}/></label>
                <label><span>Диагност</span><select value={draft.diagnostUserId || ''} onChange={(event) => setDraft({ ...draft, diagnostUserId: event.target.value || null })}><option value="">Не назначен</option>{context.users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
              </div>
              <div className="deal-workspace-relations">
                <div><span>Лид</span><strong>{deal.marketingLeadId ? 'Связан' : 'Нет связи'}</strong></div>
                <div><span>Менеджер</span><strong>{managerName}</strong></div>
                <div><span>Диагност</span><strong>{diagnostName}</strong></div>
                <div><span>Создано</span><strong>{safeDate(deal.createdAt)}</strong></div>
                <div><span>На стадии с</span><strong>{safeDate(deal.stageEnteredAt)}</strong></div>
              </div>
            </details>
          </aside>

          <main className="deal-workspace-feed">
            <nav className="deal-workspace-tabs deal-workspace-tabs--friendly">
              <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><MessageSquareText/><span>Активность</span></button>
              <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History/><span>История</span></button>
              <button type="button" className={tab === 'links' ? 'active' : ''} onClick={() => setTab('links')}><Link2/><span>Связи</span></button>
            </nav>

            {tab === 'activity' && <form className="deal-workspace-composer deal-workspace-composer--friendly" onSubmit={(event) => void postActivity(event)}>
              <div className="composer-modes">
                <button type="button" className={composerMode === 'comment' ? 'active' : ''} onClick={() => setComposerMode('comment')}><MessageSquareText/> Комментарий</button>
                <button type="button" className={composerMode === 'note' ? 'active' : ''} onClick={() => setComposerMode('note')}><NotebookPen/> Заметка</button>
              </div>
              <textarea rows={2} value={composerText} onChange={(event) => setComposerText(event.target.value)} placeholder={composerMode === 'note' ? 'Зафиксировать важную заметку…' : 'Оставить внутренний комментарий…'}/>
              <footer><span>Задачи создаются в едином модуле «Задачи».</span><button type="submit" disabled={posting || !composerText.trim()}>{posting ? <LoaderCircle className="spin"/> : <Send/>} Добавить</button></footer>
            </form>}

            {loading && <div className="deal-workspace-skeleton"><div className="skeleton-line wide"/><div className="skeleton-line medium"/><div className="skeleton-stages">{Array.from({ length: 5 }, (_, index) => <span key={index}/>)}</div></div>}
            {!loading && tab === 'links' && <div className="deal-workspace-links">
              <article><MessageCircle/><div><strong>Входящие</strong><span>{data?.conversations.length || 0} связанных диалогов</span></div><a href={contextHref('/chat', deal)}>Открыть <ExternalLink/></a></article>
              <article><PhoneCall/><div><strong>Телефония</strong><span>{data?.calls.length || 0} звонков по клиенту</span></div><a href={contextHref('/telephony', deal)}>Открыть <ExternalLink/></a></article>
              <article><ListChecks/><div><strong>Задачи</strong><span>Единый список задач команды</span></div><a href={contextHref('/tasks', deal)}>Открыть <ExternalLink/></a></article>
              <article><CalendarDays/><div><strong>Расписание</strong><span>Запись клиента без отдельного CRM-календаря</span></div><a href={contextHref('/schedule', deal)}>Открыть <ExternalLink/></a></article>
              <article><UserRound/><div><strong>Лид</strong><span>{deal.marketingLeadId ? 'Связан со сделкой' : 'Связанный лид не найден'}</span></div><a href={contextHref('/leads', deal)}>Открыть <ExternalLink/></a></article>
            </div>}

            {!loading && tab !== 'links' && visibleTimeline.length === 0 && <EmptyPanel title="Событий пока нет" text="Комментарии, сообщения, звонки и изменения стадии появятся здесь."/>}
            {!loading && tab !== 'links' && visibleTimeline.length > 0 && <div className="deal-workspace-timeline">
              {visibleTimeline.map((item) => <article key={item.id} className={`${item.kind} ${item.completed ? 'completed' : ''}`}>
                <div className="timeline-icon">{item.kind === 'message' ? <MessageCircle/> : item.kind === 'call' ? <PhoneCall/> : item.kind === 'stage' ? <ChevronRight/> : item.activityType === 'task' ? <SquareCheckBig/> : <NotebookPen/>}</div>
                <div className="timeline-card"><header><div><strong>{item.title}</strong>{item.author && <span>{item.author}</span>}</div><time>{safeDate(item.at)}</time></header>
                  {item.body && <p>{item.body}</p>}
                  {item.dueAt && <div className="timeline-due"><Clock3/>Срок: {safeDate(item.dueAt)}</div>}
                  {item.recordingUrl && <a className="timeline-recording" href={item.recordingUrl} target="_blank" rel="noreferrer"><PhoneCall/> Прослушать запись</a>}
                  {item.activityType === 'task' && item.activityId && <footer><button type="button" onClick={() => void toggleLegacyTask(item.activityId!, Boolean(item.completed))}>{item.completed ? <><CheckCircle2/> Вернуть в работу</> : <><SquareCheckBig/> Выполнено</>}</button></footer>}
                </div>
              </article>)}
            </div>}
          </main>
        </div>
      </section>
    </div>
  </>;
}
