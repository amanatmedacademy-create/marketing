import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckSquare, MessageCircle, Phone, RefreshCw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { customer360Api, type Customer360Detail, type Customer360Summary } from '../services/customer360';
import '../strategic-platform.css';

const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const journeyLabels: Record<string, string> = { lead_created: 'Лид создан', first_contact: 'Первый контакт', qualified: 'Целевой лид', call: 'Звонок', conversation: 'Диалог', message: 'Сообщение', appointment_booked: 'Запись', arrived: 'Пациент пришёл', deal_created: 'Сделка создана', rejected: 'Отказ', sale: 'Продажа' };

type TimelineItem = { date: string; title: string; text: string; kind: string };

function route(path: string, params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  window.location.href = `${path}${query.size ? `?${query.toString()}` : ''}`;
}

function buildTimeline(data: Customer360Detail): TimelineItem[] {
  const rows: TimelineItem[] = [
    ...data.journey.map(item => ({ date: item.occurredAt, kind: 'journey', title: `${journeyLabels[item.type] || item.type}${Number(item.value || 0) > 0 ? ` · ${money(Number(item.value || 0))}` : ''}`, text: item.source || item.channel || 'Patient Journey' })),
    ...data.leads.map(item => ({ date: item.createdAt, kind: 'lead', title: `Лид · ${item.stage || 'без стадии'}`, text: item.source || item.platform || 'Источник не указан' })),
    ...data.deals.map(item => ({ date: item.updatedAt, kind: 'deal', title: `Сделка · ${item.stageName || item.status}`, text: `${item.title}${Number(item.amount || 0) > 0 ? ` · ${money(item.amount)}` : ''}` })),
    ...data.calls.map(item => ({ date: item.startedAt, kind: 'call', title: `Звонок · ${item.result || item.status || 'без результата'}`, text: `${item.direction || item.channel || 'Телефония'} · ${Math.round(Number(item.durationSeconds || 0) / 60)} мин` })),
    ...data.messages.slice(0, 80).map(item => ({ date: item.sentAt, kind: 'message', title: item.direction === 'inbound' ? 'Входящее сообщение' : 'Исходящее сообщение', text: item.body || item.attachmentName || 'Вложение' })),
    ...data.appointments.map(item => ({ date: item.startsAt, kind: 'appointment', title: `Запись · ${item.status}`, text: item.patientName || item.source || 'Расписание' })),
    ...data.tasks.map(item => ({ date: item.dueAt || item.completedAt || '', kind: 'task', title: `Задача · ${item.status}`, text: item.title })),
  ];
  return rows.filter(item => item.date).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 160);
}

export default function Customer360Page() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer360Summary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Customer360Detail | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadCustomers = async (needle = query) => {
    setLoading(true); setMessage(null);
    try { setCustomers(await customer360Api.list(needle)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка загрузки Customer 360'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadCustomers(''); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCustomers(query); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const requestedContact = searchParams.get('contact_id');
    const requestedLead = searchParams.get('lead_id');
    const choose = async () => {
      let next = requestedContact || '';
      if (!next && requestedLead) {
        try { next = (await customer360Api.resolveLead(requestedLead)).contactId || ''; } catch { next = ''; }
      }
      if (!next && selectedId && customers.some(item => item.id === selectedId)) next = selectedId;
      if (!next) next = customers[0]?.id || '';
      if (cancelled) return;
      setSelectedId(next);
      if (next && (searchParams.get('contact_id') !== next || requestedLead)) {
        const params = new URLSearchParams(searchParams); params.set('contact_id', next); params.delete('lead_id'); setSearchParams(params, { replace: true });
      }
    };
    void choose();
    return () => { cancelled = true; };
  }, [customers, searchParams, selectedId, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true); setMessage(null);
    void customer360Api.detail(selectedId).then(payload => { if (!cancelled) setDetail(payload); }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Ошибка карточки клиента'); }).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const timeline = useMemo(() => detail ? buildTimeline(detail) : [], [detail]);
  const currentSummary = customers.find(item => item.id === selectedId);

  const selectCustomer = (id: string) => {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams); params.set('contact_id', id); params.delete('lead_id'); setSearchParams(params, { replace: true });
  };

  const primaryLead = detail?.leads[0];
  const primaryDeal = detail?.deals.find(item => item.status === 'open') || detail?.deals[0];
  const phone = detail?.contact.phone || primaryLead?.phone || primaryDeal?.phone || null;
  const context = { contact_id: selectedId, lead_id: primaryLead?.id, deal_id: primaryDeal?.id, phone };

  return <div className="strategic-page">
    <div className="strategic-head">
      <div><span>CRM / Customer 360</span><h1>Клиенты 360°</h1><p>Один клиент = один crm_contact. Лиды, сделки, звонки, WhatsApp, записи, задачи и Patient Journey связаны по постоянному contact_id.</p></div>
      <button className="button" onClick={() => void loadCustomers()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Обновление…' : 'Обновить'}</button>
    </div>
    {message && <div className="alert alert--error">{message}</div>}
    {loading && !customers.length ? <div className="suite-state">Загружаем канонических клиентов…</div> : <div className="customer-layout">
      <section className="panel">
        <label className="ads-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Имя, телефон или email"/></label>
        <div className="customer-list">{customers.map(customer => <button key={customer.id} className={`customer-row ${selectedId === customer.id ? 'active' : ''}`} onClick={() => selectCustomer(customer.id)}>
          <div><b>{customer.fullName}</b><small>{customer.phone || customer.email || 'Контакт не указан'} · {customer.openDealCount ? `Открытых сделок: ${customer.openDealCount}` : `Лидов: ${customer.leadCount}`}</small></div>
          <strong>{money(customer.revenue)}</strong>
        </button>)}{!customers.length && <div className="suite-state">Клиенты не найдены.</div>}</div>
      </section>

      <section className="panel customer-profile">{detailLoading ? <div className="suite-state">Собираем историю клиента…</div> : detail ? <>
        <div className="customer-profile-head"><div><h2>{detail.contact.fullName}</h2><p>{detail.contact.phone || 'телефон не указан'} · {detail.contact.email || 'email не указан'} · ID {detail.contact.id.slice(0, 8)}</p></div><span className="badge">{detail.deals.find(item => item.status === 'open')?.stageName || detail.contact.source || 'Клиент'}</span></div>

        <div className="customer-facts">
          <div><span>Лидов</span><b>{detail.stats.leadCount}</b></div><div><span>Сделок</span><b>{detail.stats.dealCount}</b></div><div><span>Звонков</span><b>{detail.stats.callCount}</b></div><div><span>Выручка</span><b>{money(detail.stats.revenue)}</b></div>
        </div>
        <div className="customer-facts">
          <div><span>Диалогов</span><b>{detail.stats.conversationCount}</b></div><div><span>Записей</span><b>{detail.stats.appointmentCount}</b></div><div><span>Задач</span><b>{detail.tasks.filter(item => item.status !== 'done' && item.status !== 'completed').length}</b></div><div><span>Источник</span><b>{detail.contact.source || primaryLead?.source || '—'}</b></div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button" onClick={() => route('/telephony', context)}><Phone size={14}/>Позвонить</button>
          <button className="button" onClick={() => route('/chat', context)}><MessageCircle size={14}/>WhatsApp / чат</button>
          <button className="button" onClick={() => route('/tasks', context)}><CheckSquare size={14}/>Задачи</button>
          <button className="button" onClick={() => route('/schedule', context)}><CalendarDays size={14}/>Расписание</button>
          {primaryDeal && <button className="button" onClick={() => { window.location.href = `/pipeline/deal/${primaryDeal.id}`; }}>Открыть сделку</button>}
        </div>

        {primaryDeal && <div className="customer-facts">
          <div><span>Текущая сделка</span><b>{primaryDeal.title}</b></div><div><span>Этап</span><b>{primaryDeal.stageName || primaryDeal.status}</b></div><div><span>Следующее действие</span><b>{primaryDeal.nextAction || 'Не задано'}</b></div><div><span>Срок</span><b>{dateTime(primaryDeal.nextActionAt)}</b></div>
        </div>}

        <div><h3>Единая история</h3><div className="timeline">{timeline.map((item, index) => <div className="timeline-item" key={`${item.kind}-${item.date}-${index}`}><i/><div><b>{item.title}</b><p>{item.text} · {dateTime(item.date)}</p></div></div>)}{!timeline.length && <div className="suite-state">История пока пуста.</div>}</div></div>
      </> : <div className="suite-state">Выберите клиента.</div>}</section>
    </div>}
  </div>;
}
