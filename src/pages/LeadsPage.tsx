import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarClock, Check, ExternalLink, Filter, MessageCircle, PhoneCall, RefreshCw, Search, UserRound, X } from 'lucide-react';
import { marketingApi, type MarketingCall, type MarketingLead } from '../services/api';
import { fetchChatWorkspace, type ChatThread } from '../services/callCenterChat';
import { fetchFunnelWorkspace, type FunnelLead, type FunnelUser } from '../services/salesFunnel';
import '../leads-workspace.css';

type ExtendedLead = MarketingLead & {
  first_name?: string | null;
  last_name?: string | null;
  social_username?: string | null;
  name_locked?: boolean;
  first_contact_at?: string | null;
  qualified_at?: string | null;
  rejected_at?: string | null;
};

type LeadRow = {
  lead: ExtendedLead;
  thread?: ChatThread;
  call?: MarketingCall;
  funnel?: FunnelLead;
  manager?: FunnelUser;
  duplicateCount: number;
  lastContactAt?: string;
};

type FilterMode = 'ALL' | 'NEW' | 'UNASSIGNED' | 'NO_PHONE' | 'PENDING_CALL' | 'UNREAD' | 'DUPLICATE';

const STAGE_LABELS: Record<string, string> = {
  NEW: 'Новый', QUALIFICATION: 'Квалификация', APPOINTMENT: 'Запись',
  DIAGNOSTIC: 'Диагностика', COURSE: 'Курс оплачен', LOST: 'Потерян',
  Новый: 'Новый', Квалификация: 'Квалификация', Записан: 'Запись',
  Пришёл: 'Диагностика', Продажа: 'Курс оплачен', Отказ: 'Потерян'
};

const STAGE_CANONICAL: Record<string, string> = {
  Новый: 'NEW', Квалификация: 'QUALIFICATION', Записан: 'APPOINTMENT',
  Запись: 'APPOINTMENT', Пришёл: 'DIAGNOSTIC', Диагностика: 'DIAGNOSTIC',
  Продажа: 'COURSE', 'Курс оплачен': 'COURSE', Отказ: 'LOST', Потерян: 'LOST',
};

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram Direct', WEB: 'Сайт', PHONE: 'Телефон', OTHER: 'Другой'
};

const formatDate = (value?: string | null) => value
  ? new Date(value).toLocaleString('ru-KZ', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

function phoneDigits(value?: string | null) {
  return (value || '').replace(/\D/g, '');
}

function formatKzPhone(value?: string | null) {
  const digits = phoneDigits(value).slice(0, 11);
  if (!digits) return '';
  if (digits.length === 10) return `+7${digits}`;
  if (digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.startsWith('7')) return `+${digits}`;
  return `+${digits}`;
}

function fullName(lead: ExtendedLead) {
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || lead.name || lead.social_username || lead.phone || 'Без имени';
}

function leadStage(row: LeadRow) {
  return row.funnel?.stage || row.lead.stage || 'NEW';
}

function canonicalStage(value?: string | null) {
  const stage = String(value || 'NEW').trim();
  return STAGE_CANONICAL[stage] || stage.toUpperCase();
}

function stageLabel(row: LeadRow) {
  const raw = leadStage(row);
  const canonical = canonicalStage(raw);
  return STAGE_LABELS[canonical] || STAGE_LABELS[raw] || raw;
}

export function LeadsPage() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('ALL');
  const [source, setSource] = useState('ALL');
  const [stage, setStage] = useState('ALL');
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState({ firstName: '', lastName: '', phone: '', email: '', nextAction: '' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [leadRows, chat, calls, funnel] = await Promise.all([
        marketingApi.listLeads({ limit: 500 }) as Promise<ExtendedLead[]>,
        fetchChatWorkspace(),
        marketingApi.calls({ limit: 500 }),
        fetchFunnelWorkspace({ limit: 1000 })
      ]);

      const phoneCounts = new Map<string, number>();
      const emailCounts = new Map<string, number>();
      leadRows.forEach((lead) => {
        const phone = phoneDigits(lead.phone);
        const email = (lead.email || '').trim().toLowerCase();
        if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
        if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
      });

      const result = leadRows.map((lead): LeadRow => {
        const thread = chat.threads
          .filter((item) => item.leadId === lead.id)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        const call = calls
          .filter((item) => item.lead_id === lead.id)
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
        const funnelLead = funnel.leads
          .filter((item) => item.contactId === lead.id || (thread && item.id === `chat_${thread.id}`))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        const managerId = funnelLead?.managerUserId || thread?.assignedUserId;
        const manager = funnel.users.find((item) => item.id === managerId);
        const phone = phoneDigits(lead.phone);
        const email = (lead.email || '').trim().toLowerCase();
        const duplicateCount = Math.max(
          phone ? (phoneCounts.get(phone) || 1) - 1 : 0,
          email ? (emailCounts.get(email) || 1) - 1 : 0
        );
        const dates = [lead.updated_at, lead.first_contact_at, thread?.lastMessageAt, call?.updated_at, funnelLead?.updatedAt]
          .filter(Boolean).map((value) => new Date(value as string).getTime()).filter(Number.isFinite);
        return { lead, thread, call, funnel: funnelLead, manager, duplicateCount, lastContactAt: dates.length ? new Date(Math.max(...dates)).toISOString() : undefined };
      });
      result.sort((a, b) => new Date(b.lastContactAt || 0).getTime() - new Date(a.lastContactAt || 0).getTime());
      setRows(result);
      setSelectedId((current) => current && result.some((item) => item.lead.id === current) ? current : result[0]?.lead.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить лиды');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const selected = rows.find((row) => row.lead.id === selectedId) || null;
  const sources = useMemo(() => Array.from(new Set(rows.map((row) => row.lead.source).filter(Boolean) as string[])).sort(), [rows]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return rows.filter((row) => {
      const lead = row.lead;
      const normalizedStage = canonicalStage(leadStage(row));
      if (source !== 'ALL' && lead.source !== source) return false;
      if (stage !== 'ALL' && normalizedStage !== stage) return false;
      if (filter === 'NEW' && normalizedStage !== 'NEW') return false;
      if (filter === 'UNASSIGNED' && (row.manager || row.thread?.assignedUserId)) return false;
      if (filter === 'NO_PHONE' && phoneDigits(lead.phone)) return false;
      if (filter === 'PENDING_CALL' && row.call?.call_status !== 'PENDING') return false;
      if (filter === 'UNREAD' && !(row.thread?.unreadCount && row.thread.unreadCount > 0)) return false;
      if (filter === 'DUPLICATE' && row.duplicateCount === 0) return false;
      if (!text) return true;
      return [fullName(lead), lead.phone, lead.email, lead.social_username, lead.source, lead.platform, lead.campaign, lead.first_message, row.manager?.fullName]
        .some((value) => value?.toLowerCase().includes(text));
    });
  }, [filter, query, rows, source, stage]);

  const metrics = useMemo(() => ({
    total: rows.length,
    newLeads: rows.filter((row) => canonicalStage(leadStage(row)) === 'NEW').length,
    unassigned: rows.filter((row) => !row.manager && !row.thread?.assignedUserId).length,
    pendingCalls: rows.filter((row) => row.call?.call_status === 'PENDING').length,
    unread: rows.filter((row) => Boolean(row.thread?.unreadCount)).length,
    duplicates: rows.filter((row) => row.duplicateCount > 0).length
  }), [rows]);

  const openEdit = () => {
    if (!selected) return;
    setDraft({
      firstName: selected.lead.first_name || '',
      lastName: selected.lead.last_name || '',
      phone: formatKzPhone(selected.lead.phone),
      email: selected.lead.email || '',
      nextAction: selected.lead.next_action || selected.call?.next_action || ''
    });
    setEditOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const name = [draft.firstName.trim(), draft.lastName.trim()].filter(Boolean).join(' ') || 'Без имени';
      await marketingApi.updateLead(selected.lead.id, {
        name,
        first_name: draft.firstName.trim() || null,
        last_name: draft.lastName.trim() || null,
        phone: formatKzPhone(draft.phone),
        email: draft.email.trim() || null,
        next_action: draft.nextAction.trim() || null,
        name_locked: true
      });
      setEditOpen(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения');
    } finally {
      setSaving(false);
    }
  };

  const contactPhone = formatKzPhone(selected?.lead.phone);
  const whatsappPhone = phoneDigits(contactPhone);

  return <div className="leads-workspace">
    <header className="leads-heading">
      <div><span>CRM · ЕДИНЫЙ РЕЕСТР</span><h1>Лиды</h1><p>Каждое обращение связано с чатом, задачей на звонок и карточкой воронки.</p></div>
      <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>{loading ? 'Обновление…' : 'Обновить'}</button>
    </header>

    <section className="lead-metrics">
      <button type="button" onClick={() => setFilter('ALL')} className={filter === 'ALL' ? 'active' : ''}><span>Все лиды</span><b>{metrics.total}</b></button>
      <button type="button" onClick={() => setFilter('NEW')} className={filter === 'NEW' ? 'active' : ''}><span>Новые</span><b>{metrics.newLeads}</b></button>
      <button type="button" onClick={() => setFilter('UNASSIGNED')} className={filter === 'UNASSIGNED' ? 'active' : ''}><span>Без ответственного</span><b>{metrics.unassigned}</b></button>
      <button type="button" onClick={() => setFilter('PENDING_CALL')} className={filter === 'PENDING_CALL' ? 'active' : ''}><span>Ожидают звонка</span><b>{metrics.pendingCalls}</b></button>
      <button type="button" onClick={() => setFilter('UNREAD')} className={filter === 'UNREAD' ? 'active' : ''}><span>Непрочитанные</span><b>{metrics.unread}</b></button>
      <button type="button" onClick={() => setFilter('DUPLICATE')} className={filter === 'DUPLICATE' ? 'active' : ''}><span>Дубли</span><b>{metrics.duplicates}</b></button>
    </section>

    <section className="lead-filters">
      <label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, телефон, email, источник, сообщение"/></label>
      <label className="lead-filter-select"><Filter size={15}/><select value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">Все источники</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
      <select value={stage} onChange={(event) => setStage(event.target.value)}><option value="ALL">Все стадии</option>{Object.entries(STAGE_LABELS).filter(([key]) => ['NEW','QUALIFICATION','APPOINTMENT','DIAGNOSTIC','COURSE','LOST'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <button type="button" onClick={() => setFilter('NO_PHONE')} className={filter === 'NO_PHONE' ? 'active' : ''}>Без телефона</button>
    </section>

    {error && <div className="lead-error"><AlertTriangle size={18}/><span>{error}</span><button type="button" onClick={() => setError('')}><X size={16}/></button></div>}
    {loading && <div className="lead-state">Загрузка единого реестра…</div>}
    {!loading && !rows.length && <div className="lead-state">Лидов пока нет.</div>}

    {!loading && rows.length > 0 && <main className="lead-layout">
      <section className="lead-table-panel">
        <header><strong>Результаты</strong><span>{filtered.length} из {rows.length}</span></header>
        <div className="lead-table-wrap"><table><thead><tr><th>Клиент</th><th>Источник / канал</th><th>Стадия</th><th>Ответственный</th><th>Следующее действие</th><th>Последний контакт</th></tr></thead><tbody>
          {filtered.map((row) => <tr key={row.lead.id} className={selectedId === row.lead.id ? 'selected' : ''} onClick={() => setSelectedId(row.lead.id)}>
            <td><div className="lead-client"><span>{fullName(row.lead).slice(0, 1).toUpperCase()}</span><div><b>{fullName(row.lead)}</b><small>{formatKzPhone(row.lead.phone) || row.lead.email || row.lead.social_username || 'Контакты не указаны'}</small>{row.duplicateCount > 0 && <em>Возможный дубль · {row.duplicateCount}</em>}</div></div></td>
            <td><b>{row.lead.source || 'Не указан'}</b><small>{row.thread ? CHANNEL_LABELS[row.thread.channel] || row.thread.channel : row.lead.platform || 'Канал не определён'}</small></td>
            <td><span className={`lead-stage stage-${canonicalStage(leadStage(row)).toLowerCase()}`}>{stageLabel(row)}</span></td>
            <td>{row.manager?.fullName || row.thread?.assignedUser?.fullName || row.lead.manager || 'Не назначен'}</td>
            <td>{row.call?.call_status === 'PENDING' ? row.call.next_action || 'Позвонить клиенту' : row.lead.next_action || 'Не назначено'}</td>
            <td>{formatDate(row.lastContactAt)}</td>
          </tr>)}
        </tbody></table></div>
      </section>

      <aside className="lead-card">
        {!selected ? <div className="lead-state">Выберите лида</div> : <>
          <header className="lead-card-head"><div className="lead-avatar">{fullName(selected.lead).slice(0, 2).toUpperCase()}</div><div><span>{selected.lead.external_id || selected.lead.id.slice(0, 8)}</span><h2>{fullName(selected.lead)}</h2><p>{selected.lead.social_username || selected.lead.email || contactPhone || 'Контакты не указаны'}</p></div><button type="button" onClick={openEdit}>Изменить</button></header>

          <div className="lead-actions">
            {selected.thread && <a href={`/chat?conversation=${encodeURIComponent(selected.thread.id)}`}><MessageCircle size={17}/>Открыть чат</a>}
            {contactPhone && <a href={`tel:${contactPhone}`}><PhoneCall size={17}/>Позвонить</a>}
            {whatsappPhone && <a href={`https://wa.me/${whatsappPhone}`} target="_blank" rel="noreferrer"><ExternalLink size={17}/>WhatsApp</a>}
            {selected.funnel ? <a href="/pipeline"><ExternalLink size={17}/>Открыть воронку</a> : <span title="Для этого лида сделка в воронке ещё не создана">Воронка не создана</span>}
          </div>

          <section><h3>Статус обработки</h3><div className="lead-status-grid">
            <article><MessageCircle/><span>Чат</span><b>{selected.thread ? `${CHANNEL_LABELS[selected.thread.channel] || selected.thread.channel} · ${selected.thread.status}` : 'Не создан'}</b><small>{selected.thread?.unreadCount ? `${selected.thread.unreadCount} непрочитано` : 'Нет непрочитанных'}</small></article>
            <article><PhoneCall/><span>Звонок</span><b>{selected.call?.call_status === 'PENDING' ? 'Ожидает звонка' : selected.call?.call_status === 'COMPLETED' ? 'Выполнен' : 'Нет задачи'}</b><small>{selected.call?.next_action || 'Следующее действие не назначено'}</small></article>
            <article><CalendarClock/><span>Воронка</span><b>{stageLabel(selected)}</b><small>{selected.funnel?.priority || 'Приоритет не задан'}</small></article>
            <article><UserRound/><span>Ответственный</span><b>{selected.manager?.fullName || selected.thread?.assignedUser?.fullName || 'Не назначен'}</b><small>{selected.manager?.role || ''}</small></article>
          </div></section>

          <section><h3>Контакт и источник</h3><dl className="lead-details">
            <div><dt>Имя</dt><dd>{selected.lead.first_name || '—'}</dd></div><div><dt>Фамилия</dt><dd>{selected.lead.last_name || '—'}</dd></div>
            <div><dt>Телефон</dt><dd>{contactPhone || '—'}</dd></div><div><dt>Email</dt><dd>{selected.lead.email || '—'}</dd></div>
            <div><dt>Источник</dt><dd>{selected.lead.source || '—'}</dd></div><div><dt>Канал общения</dt><dd>{selected.thread ? CHANNEL_LABELS[selected.thread.channel] || selected.thread.channel : '—'}</dd></div>
            <div><dt>Кампания</dt><dd>{selected.lead.campaign || selected.lead.utm_campaign || '—'}</dd></div><div><dt>Объявление</dt><dd>{selected.lead.ad_id || '—'}</dd></div>
          </dl></section>

          <section><h3>Обращение</h3><div className="lead-message"><span>Первое сообщение</span><p>{selected.lead.first_message || 'Текст обращения отсутствует'}</p></div><div className="lead-message"><span>Следующее действие</span><p>{selected.call?.next_action || selected.lead.next_action || 'Не назначено'}</p></div></section>
        </>}
      </aside>
    </main>}

    {editOpen && selected && <div className="lead-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditOpen(false); }}>
      <form className="lead-modal" onSubmit={(event) => void save(event)}>
        <header><div><span>КАРТОЧКА ЛИДА</span><h2>Редактировать контакт</h2></div><button type="button" onClick={() => setEditOpen(false)}><X/></button></header>
        <div className="lead-modal-body">
          <label><span>Имя</span><input value={draft.firstName} onChange={(event) => setDraft((value) => ({ ...value, firstName: event.target.value }))}/></label>
          <label><span>Фамилия</span><input value={draft.lastName} onChange={(event) => setDraft((value) => ({ ...value, lastName: event.target.value }))}/></label>
          <label><span>Телефон</span><input inputMode="tel" value={draft.phone} placeholder="+77006166067" onChange={(event) => setDraft((value) => ({ ...value, phone: formatKzPhone(event.target.value) }))}/></label>
          <label><span>Email</span><input type="email" value={draft.email} onChange={(event) => setDraft((value) => ({ ...value, email: event.target.value }))}/></label>
          <label className="wide"><span>Следующее действие</span><textarea rows={3} value={draft.nextAction} onChange={(event) => setDraft((value) => ({ ...value, nextAction: event.target.value }))}/></label>
          <p><Check size={16}/>После сохранения имя фиксируется и не перезаписывается платформой.</p>
        </div>
        <footer><button type="button" className="button button-secondary" onClick={() => setEditOpen(false)} disabled={saving}>Отмена</button><button className="button button-primary" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button></footer>
      </form>
    </div>}
  </div>;
}
