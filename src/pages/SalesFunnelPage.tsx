import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createFunnelLead,
  fetchFunnelWorkspace,
  runFunnelLeadAction,
  searchFunnelContacts,
  updateFunnelLead,
  type FunnelContact,
  type FunnelLead,
  type FunnelLeadAction,
  type FunnelLeadInput,
  type FunnelLeadPriority,
  type FunnelLeadStage,
  type FunnelWorkspace,
  type FunnelWorkspaceStats
} from '../services/salesFunnel';
import { SalesFunnelKanban } from '../components/SalesFunnelKanban';
import '../sales-funnel.css';

const PAGE_SIZE = 500;
const STAGES: Array<{ id: FunnelLeadStage; title: string }> = [
  { id: 'NEW', title: 'Новые' },
  { id: 'QUALIFICATION', title: 'Квалификация' },
  { id: 'APPOINTMENT', title: 'Запись' },
  { id: 'DIAGNOSTIC', title: 'Диагностика' },
  { id: 'COURSE', title: 'Курс оплачен' },
  { id: 'LOST', title: 'Потеряны' }
];

const PRIORITY_LABELS: Record<FunnelLeadPriority, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный'
};

const EMPTY_LEAD: FunnelLeadInput = {
  contactId: null,
  fullName: '',
  phone: '',
  diagnosis: '',
  source: 'Маркетинг',
  priority: 'MEDIUM',
  stage: 'NEW',
  diagnostUserId: null,
  managerUserId: null,
  amount: 0,
  paid: false,
  lostReason: ''
};

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });

function adjustStats(stats: FunnelWorkspaceStats | undefined, before: FunnelLead | undefined, after: FunnelLead): FunnelWorkspaceStats | undefined {
  if (!stats) return stats;
  const next: FunnelWorkspaceStats = { ...stats, byStage: { ...stats.byStage } };
  const remove = (lead: FunnelLead) => {
    next.total = Math.max(0, next.total - 1);
    next.byStage[lead.stage] = Math.max(0, next.byStage[lead.stage] - 1);
    if (lead.stage === 'COURSE') { next.won = Math.max(0, next.won - 1); next.courseAmount -= lead.amount; }
    else if (lead.stage === 'LOST') next.lost = Math.max(0, next.lost - 1);
    else next.open = Math.max(0, next.open - 1);
  };
  const add = (lead: FunnelLead) => {
    next.total += 1;
    next.byStage[lead.stage] += 1;
    if (lead.stage === 'COURSE') { next.won += 1; next.courseAmount += lead.amount; }
    else if (lead.stage === 'LOST') next.lost += 1;
    else next.open += 1;
  };
  if (before) remove(before);
  add(after);
  return next;
}

function mergeLeads(current: FunnelLead[], incoming: FunnelLead[]): FunnelLead[] {
  const seen = new Set(current.map((lead) => lead.id));
  return [...current, ...incoming.filter((lead) => !seen.has(lead.id))];
}

export function SalesFunnelPage() {
  const [workspace, setWorkspace] = useState<FunnelWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [query, setQuery] = useState('');
  const [diagnostId, setDiagnostId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [priority, setPriority] = useState<FunnelLeadPriority | ''>('');
  const [stageFilter, setStageFilter] = useState<FunnelLeadStage | ''>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FunnelLeadInput>(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activityLeadId, setActivityLeadId] = useState<string | null>(null);
  const [contactQuery, setContactQuery] = useState('');
  const [contactOptions, setContactOptions] = useState<FunnelContact[]>([]);
  const [contactSearching, setContactSearching] = useState(false);

  const requestFilters = useMemo(() => ({
    query: query.trim(),
    diagnostId,
    managerId,
    priority,
    stage: stageFilter
  }), [diagnostId, managerId, priority, query, stageFilter]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      setWorkspace(await fetchFunnelWorkspace({ offset: 0, limit: PAGE_SIZE, ...requestFilters }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить воронку продаж');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [requestFilters]);

  const loadMore = useCallback(async () => {
    if (!workspace?.pagination?.hasMore || loadingMore) return;
    const offset = workspace.pagination.nextOffset ?? workspace.leads.length;
    setLoadingMore(true);
    setActionError('');
    try {
      const next = await fetchFunnelWorkspace({ offset, limit: PAGE_SIZE, ...requestFilters });
      setWorkspace((current) => {
        if (!current) return next;
        const leads = mergeLeads(current.leads, next.leads);
        return {
          ...current,
          leads,
          stats: next.stats ?? current.stats,
          pagination: next.pagination ? { ...next.pagination, loaded: leads.length } : current.pagination,
          filters: next.filters ?? current.filters
        };
      });
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить следующую страницу лидов');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, requestFilters, workspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    if (!modalOpen) return;
    const timer = window.setTimeout(async () => {
      setContactSearching(true);
      try {
        const found = await searchFunnelContacts(contactQuery, 50);
        setContactOptions((current) => {
          const selectedId = draft.contactId || '';
          const selected = current.find((contact) => contact.id === selectedId) || workspace?.contacts.find((contact) => contact.id === selectedId);
          return selected && !found.some((contact) => contact.id === selected.id) ? [selected, ...found] : found;
        });
      } catch (nextError) {
        setActionError(nextError instanceof Error ? nextError.message : 'Не удалось найти контакт');
      } finally {
        setContactSearching(false);
      }
    }, contactQuery.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [draft.contactId, modalOpen, contactQuery, workspace?.contacts]);

  const loadedLeads = workspace?.leads || [];
  const totalAmount = workspace?.stats?.courseAmount ?? loadedLeads.filter((lead) => lead.stage === 'COURSE').reduce((sum, lead) => sum + lead.amount, 0);
  const won = workspace?.stats?.won ?? loadedLeads.filter((lead) => lead.stage === 'COURSE').length;
  const lost = workspace?.stats?.lost ?? loadedLeads.filter((lead) => lead.stage === 'LOST').length;
  const open = workspace?.stats?.open ?? loadedLeads.filter((lead) => !['COURSE', 'LOST'].includes(lead.stage)).length;
  const totalLeads = workspace?.stats?.total ?? loadedLeads.length;
  const newLeads = workspace?.stats?.byStage.NEW ?? loadedLeads.filter((lead) => lead.stage === 'NEW').length;
  const resultTotal = workspace?.pagination?.total ?? loadedLeads.length;
  const activeFilters = Boolean(query.trim() || diagnostId || managerId || priority || stageFilter);
  const conversion = won + lost ? Math.round(won / (won + lost) * 100) : 0;

  const prepareContactOptions = (contactId?: string) => {
    const recent = workspace?.contacts || [];
    if (!contactId) { setContactOptions(recent); return; }
    const selected = recent.find((contact) => contact.id === contactId);
    setContactOptions(selected ? [selected, ...recent.filter((contact) => contact.id !== contactId)] : recent);
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_LEAD });
    setContactQuery('');
    prepareContactOptions();
    setModalOpen(true);
    setActionError('');
  };

  const openEdit = (lead: FunnelLead) => {
    setEditingId(lead.id);
    setDraft({
      contactId: lead.contactId || null,
      fullName: lead.fullName,
      phone: lead.phone || '',
      diagnosis: lead.diagnosis || '',
      source: lead.source,
      priority: lead.priority,
      stage: lead.stage,
      diagnostUserId: lead.diagnostUserId || null,
      managerUserId: lead.managerUserId || null,
      amount: lead.amount,
      paid: lead.paid,
      lostReason: lead.lostReason || ''
    });
    setContactQuery('');
    prepareContactOptions(lead.contactId);
    setModalOpen(true);
    setActionError('');
  };

  const saveLead = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setActionError('');
    try {
      const saved = editingId ? await updateFunnelLead(editingId, draft) : await createFunnelLead(draft);
      setWorkspace((current) => {
        if (!current) return current;
        const before = editingId ? current.leads.find((lead) => lead.id === saved.id) : undefined;
        const leads = editingId ? current.leads.map((lead) => lead.id === saved.id ? saved : lead) : [saved, ...current.leads];
        return { ...current, leads, stats: adjustStats(current.stats, before, saved) };
      });
      setModalOpen(false);
      setEditingId(null);
      void load(false);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось сохранить лид');
    } finally {
      setSaving(false);
    }
  };

  const moveLead = async (lead: FunnelLead, stage: FunnelLeadStage) => {
    if (lead.stage === stage) return;
    setActionError('');
    try {
      const saved = await updateFunnelLead(lead.id, { stage });
      setWorkspace((current) => current ? {
        ...current,
        leads: current.leads.map((item) => item.id === saved.id ? saved : item),
        stats: adjustStats(current.stats, lead, saved)
      } : current);
      void load(false);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Не удалось переместить лид');
    } finally {
      setDraggingId(null);
    }
  };

  const action = async (lead: FunnelLead, type: FunnelLeadAction) => {
    let lostReason: string | undefined;
    if (type === 'LOST') {
      lostReason = window.prompt('Причина потери лида', 'Не дозвонились') || undefined;
      if (!lostReason) return;
    }
    setActionError('');
    try {
      const saved = await runFunnelLeadAction(lead.id, type, lostReason);
      setWorkspace((current) => current ? {
        ...current,
        leads: current.leads.map((item) => item.id === saved.id ? saved : item),
        stats: adjustStats(current.stats, lead, saved)
      } : current);
      void load(false);
      if (type === 'WHATSAPP' && lead.phone) {
        window.open(`https://wa.me/${lead.phone.replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer');
      }
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Действие не выполнено');
    }
  };

  const onContact = (contactId: string) => {
    const contact = contactOptions.find((item) => item.id === contactId);
    setDraft((current) => ({
      ...current,
      contactId: contactId || null,
      fullName: contact?.fullName || current.fullName,
      phone: contact?.phone || current.phone,
      diagnosis: contact?.diagnosis || current.diagnosis
    }));
  };

  const activities = (workspace?.activities || []).filter((item) => !activityLeadId || item.leadId === activityLeadId).slice(0, 30);

  return <div className="stack funnel-page-root">
    <div className="heading funnel-heading">
      <div><span>Sales department</span><h1>Воронка продаж</h1><p>Рабочая воронка лидов отдела продаж: канбан, действия и история — как CRM-модуль МИС.</p></div>
      <div className="refdash-toolbar">
        <button className="button button-secondary" onClick={() => { void load(); }}>↻ Обновить</button>
        <button className="button button-primary" onClick={openCreate}>+ Новый лид</button>
      </div>
    </div>

    {loading && <div className="funnel-state">Загрузка воронки продаж…</div>}
    {error !== null && <div className="funnel-state funnel-state-error">{error}<button className="button button-secondary" onClick={() => { void load(); }}>Повторить</button></div>}

    {workspace && !loading && <div className="refdash-page rop-reference">
      {actionError && <div className="refdash-action-error">{actionError}<button onClick={() => setActionError('')}>×</button></div>}

      <section className="refdash-kpis five">
        <article className="tone-blue"><span className="refdash-kpi-icon">◎</span><div><small>Открытые лиды</small><strong>{open}</strong><em>{totalLeads} всего</em></div></article>
        <article className="tone-purple"><span className="refdash-kpi-icon">↗</span><div><small>Конверсия в курс</small><strong>{conversion}%</strong><em>{won} продаж · {lost} потерь</em></div></article>
        <article className="tone-green"><span className="refdash-kpi-icon">₸</span><div><small>Продано курсов</small><strong>{money.format(totalAmount)}</strong><em>{won} оплачено</em></div></article>
        <article className="tone-amber"><span className="refdash-kpi-icon">✶</span><div><small>Новые лиды</small><strong>{newLeads}</strong><em>ожидают обработки</em></div></article>
        <article className="tone-red"><span className="refdash-kpi-icon">×</span><div><small>Потеряно</small><strong>{lost}</strong><em>с причиной отказа</em></div></article>
      </section>

      <section className="rop-filterbar">
        <label className="rop-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, телефон, запрос, источник…" /></label>
        <label><span>Диагност</span><select value={diagnostId} onChange={(event) => setDiagnostId(event.target.value)}><option value="">Все</option>{workspace.users.map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></label>
        <label><span>ТМ / менеджер</span><select value={managerId} onChange={(event) => setManagerId(event.target.value)}><option value="">Все</option>{workspace.users.map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></label>
        <label><span>Приоритет</span><select value={priority} onChange={(event) => setPriority(event.target.value as FunnelLeadPriority | '')}><option value="">Все</option>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Стадия</span><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as FunnelLeadStage | '')}><option value="">Все</option>{STAGES.map((stage) => <option value={stage.id} key={stage.id}>{stage.title}</option>)}</select></label>
        <button onClick={() => { setQuery(''); setDiagnostId(''); setManagerId(''); setPriority(''); setStageFilter(''); }}>Сбросить</button>
      </section>

      <SalesFunnelKanban
        leads={workspace.leads}
        users={workspace.users}
        draggingId={draggingId}
        onDraggingChange={setDraggingId}
        onMove={moveLead}
        onOpen={(lead) => { setActivityLeadId(lead.id); openEdit(lead); }}
        onAction={action}
        onError={setActionError}
      />

      <div className="refdash-toolbar rop-pagination-toolbar">
        <span>Загружено {workspace.leads.length.toLocaleString('ru-KZ')} из {resultTotal.toLocaleString('ru-KZ')}{activeFilters ? ` по фильтру · ${totalLeads.toLocaleString('ru-KZ')} всего` : ' лидов'}</span>
        {workspace.pagination?.hasMore && <button className="button button-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Загрузка…' : `Показать ещё ${Math.min(PAGE_SIZE, resultTotal - workspace.leads.length).toLocaleString('ru-KZ')}`}</button>}
      </div>

      <section className="refdash-grid rop-bottom-grid">
        <article className="refdash-card span-2">
          <header><div><span className="refdash-eyebrow">Команда</span><h2>Эффективность по загруженным лидам</h2></div></header>
          <div className="rop-performance-table">
            <div className="rop-table-head"><span>Сотрудник</span><span>Лидов</span><span>Курсов</span><span>Сумма</span><span>Конверсия</span></div>
            {workspace.users.map((user) => {
              const owned = workspace.leads.filter((lead) => lead.managerUserId === user.id || lead.diagnostUserId === user.id);
              const sold = owned.filter((lead) => lead.stage === 'COURSE');
              const amount = sold.reduce((sum, lead) => sum + lead.amount, 0);
              const rate = owned.length ? Math.round(sold.length / owned.length * 100) : 0;
              return <article key={user.id}>
                <div><strong>{user.fullName}</strong><small>{user.position || user.role}</small></div>
                <span>{owned.length}</span><span>{sold.length}</span><strong>{money.format(amount)}</strong>
                <div><i style={{ width: `${rate}%` }} /><b>{rate}%</b></div>
              </article>;
            })}
          </div>
        </article>

        <article className="refdash-card rop-activity-card">
          <header><div><span className="refdash-eyebrow">История</span><h2>Последние действия</h2></div>{activityLeadId && <button onClick={() => setActivityLeadId(null)}>Все</button>}</header>
          <div>{activities.map((item) => <article key={item.id}><span className={`activity-${item.type.toLowerCase()}`}>•</span><div><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString('ru-KZ')}</small></div></article>)}{!activities.length && <div className="refdash-empty">Действий пока нет</div>}</div>
        </article>
      </section>
    </div>}

    {modalOpen && <div className="rop-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}>
      <form className="rop-modal" onSubmit={(event) => void saveLead(event)}>
        <header><div><span className="refdash-eyebrow">ВОРОНКА ПРОДАЖ</span><h2>{editingId ? 'Карточка лида' : 'Новый лид'}</h2></div><button type="button" onClick={() => setModalOpen(false)}>×</button></header>
        <div className="rop-modal-body">
          <label className="wide"><span>Поиск контакта</span><input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Имя или телефон" /><small>{contactSearching ? 'Ищем по всей базе…' : 'Показано до 50 наиболее подходящих контактов'}</small></label>
          <label className="wide"><span>Контакт из базы</span><select value={draft.contactId || ''} onChange={(event) => onContact(event.target.value)}><option value="">Новый контакт без привязки</option>{contactOptions.map((contact) => <option value={contact.id} key={contact.id}>{contact.fullName} · {contact.phone || 'без телефона'}</option>)}</select></label>
          <label className="wide"><span>ФИО *</span><input required value={draft.fullName || ''} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></label>
          <label><span>Телефон</span><input value={draft.phone || ''} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
          <label><span>Источник</span><input value={draft.source || ''} onChange={(event) => setDraft({ ...draft, source: event.target.value })} /></label>
          <label className="wide"><span>Запрос / потребность</span><textarea rows={3} value={draft.diagnosis || ''} onChange={(event) => setDraft({ ...draft, diagnosis: event.target.value })} /></label>
          <label><span>Приоритет</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as FunnelLeadPriority })}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>Стадия</span><select value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value as FunnelLeadStage })}>{STAGES.map((stage) => <option value={stage.id} key={stage.id}>{stage.title}</option>)}</select></label>
          <label><span>Диагност</span><select value={draft.diagnostUserId || ''} onChange={(event) => setDraft({ ...draft, diagnostUserId: event.target.value || null })}><option value="">Не назначен</option>{workspace?.users.map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></label>
          <label><span>ТМ / менеджер</span><select value={draft.managerUserId || ''} onChange={(event) => setDraft({ ...draft, managerUserId: event.target.value || null })}><option value="">Не назначен</option>{workspace?.users.map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></label>
          <label><span>Сумма курса, ₸</span><input type="number" min="0" step="1000" value={draft.amount || 0} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })} /></label>
          <label className="rop-checkbox"><input type="checkbox" checked={draft.paid === true} onChange={(event) => setDraft({ ...draft, paid: event.target.checked })} /><span>Оплачено</span></label>
          {draft.stage === 'LOST' && <label className="wide"><span>Причина потери</span><textarea rows={3} value={draft.lostReason || ''} onChange={(event) => setDraft({ ...draft, lostReason: event.target.value })} /></label>}
        </div>
        {actionError && <div className="refdash-action-error">{actionError}</div>}
        <footer><button type="button" className="button button-secondary" onClick={() => setModalOpen(false)}>Отмена</button><button className="button button-primary" disabled={saving}>{saving ? 'Сохранение…' : editingId ? 'Сохранить изменения' : 'Создать лид'}</button></footer>
      </form>
    </div>}
  </div>;
}
