import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { marketingApi, type MarketingCall, type MarketingLead } from '../services/api';
import '../strategic-platform.css';

const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();

type JourneyEvent = { id: string; lead_id?: string | null; event_type: string; occurred_at: string; channel?: string | null; source?: string | null; value?: number; currency?: string; metadata?: Record<string, unknown> };
const journeyLabels: Record<string, string> = { lead_created: 'Лид создан', first_contact: 'Первый контакт', qualified: 'Целевой лид', call: 'Звонок', conversation: 'Диалог', message: 'Сообщение', appointment_booked: 'Запись', arrived: 'Пациент пришёл', deal_created: 'Сделка создана', rejected: 'Отказ', sale: 'Продажа' };

async function fetchJourney(leadId: string): Promise<JourneyEvent[]> {
  const response = await fetch(`/api/growth/journey?lead_id=${encodeURIComponent(leadId)}&limit=250`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  return response.json() as Promise<JourneyEvent[]>;
}

function customerKey(lead: MarketingLead) {
  const phone = normalizePhone(lead.phone);
  const email = normalize(lead.email);
  return phone ? `phone:${phone}` : email ? `email:${email}` : `lead:${lead.id}`;
}

export default function Customer360Page() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [calls, setCalls] = useState<MarketingCall[]>([]);
  const [journeyEvents, setJourneyEvents] = useState<JourneyEvent[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      const [leadRows, callRows] = await Promise.all([marketingApi.listLeads({ limit: 1000 }), marketingApi.calls({ limit: 1000 })]);
      setLeads(leadRows); setCalls(callRows);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка загрузки Customer 360'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const customers = useMemo(() => {
    const map = new Map<string, MarketingLead[]>();
    for (const lead of leads) {
      const key = customerKey(lead);
      map.set(key, [...(map.get(key) || []), lead]);
    }
    return Array.from(map.entries()).map(([key, items]) => {
      const ordered = [...items].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      const latest = ordered[0];
      return { key, latest, items, revenue: items.reduce((sum, item) => sum + Number(item.sale_amount || 0), 0) };
    }).sort((a, b) => b.revenue - a.revenue || new Date(b.latest.updated_at).getTime() - new Date(a.latest.updated_at).getTime());
  }, [leads]);

  const visibleCustomers = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return customers;
    return customers.filter(customer => customer.items.some(lead => [lead.name, lead.phone, lead.email, lead.source, lead.manager].some(value => normalize(value).includes(needle))));
  }, [customers, query]);

  useEffect(() => {
    if (!customers.length) { setSelected(''); return; }
    const requestedCustomer = searchParams.get('customer');
    const requestedLead = searchParams.get('lead_id');
    let nextKey = '';
    if (requestedCustomer && customers.some(customer => customer.key === requestedCustomer)) nextKey = requestedCustomer;
    else if (requestedLead) nextKey = customers.find(customer => customer.items.some(lead => lead.id === requestedLead))?.key || '';
    if (!nextKey && selected && customers.some(customer => customer.key === selected)) nextKey = selected;
    if (!nextKey) nextKey = customers[0].key;
    if (nextKey !== selected) setSelected(nextKey);
    if ((requestedCustomer || requestedLead) && nextKey) {
      const next = new URLSearchParams(searchParams);
      next.set('customer', nextKey);
      next.delete('lead_id');
      if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    }
  }, [customers, searchParams, selected, setSearchParams]);

  const current = customers.find(item => item.key === selected) || customers[0];
  const currentPhones = useMemo(() => new Set((current?.items || []).map(lead => normalizePhone(lead.phone)).filter(Boolean)), [current]);
  const currentLeadIds = useMemo(() => new Set((current?.items || []).map(lead => lead.id)), [current]);
  const relatedCalls = useMemo(() => current ? calls.filter(call => {
    const phone = normalizePhone(call.client_phone);
    return (phone && currentPhones.has(phone)) || Boolean(call.lead_id && currentLeadIds.has(call.lead_id));
  }) : [], [calls, current, currentLeadIds, currentPhones]);

  useEffect(() => {
    let cancelled = false;
    const leadIds = current?.items.map(item => item.id).filter(Boolean) || [];
    if (!leadIds.length) { setJourneyEvents([]); return; }
    void Promise.all(leadIds.map(fetchJourney)).then(groups => {
      if (!cancelled) setJourneyEvents(groups.flat().sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()));
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Ошибка Patient Journey'); });
    return () => { cancelled = true; };
  }, [current?.key]);

  const timeline = useMemo(() => {
    if (!current) return [];
    if (journeyEvents.length) return journeyEvents.slice(0, 100).map(event => ({
      date: event.occurred_at,
      title: `${journeyLabels[event.event_type] || event.event_type}${Number(event.value || 0) > 0 ? ` · ${money(Number(event.value || 0))}` : ''}`,
      text: `${event.source || event.channel || 'Источник не указан'}${event.event_type === 'call' && event.metadata?.operator ? ` · ${String(event.metadata.operator)}` : ''}`,
    }));
    const rows = [
      ...current.items.map(lead => ({ date: lead.lead_created_at || lead.created_at, title: `Лид · ${lead.stage}`, text: `${lead.source || lead.platform || 'Источник не указан'}${lead.campaign ? ` · ${lead.campaign}` : ''}` })),
      ...relatedCalls.map(call => ({ date: call.started_at, title: `Звонок · ${call.call_result || call.call_status || 'без результата'}`, text: `${call.operator_name || 'Оператор не указан'} · ${Math.round(Number(call.duration_seconds || 0) / 60)} мин${call.appointment_created ? ' · создана запись' : ''}` })),
    ];
    return rows.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()).slice(0, 100);
  }, [current, journeyEvents, relatedCalls]);

  const selectCustomer = (key: string) => {
    setSelected(key);
    const next = new URLSearchParams(searchParams);
    next.set('customer', key);
    next.delete('lead_id');
    setSearchParams(next, { replace: true });
  };

  return <div className="strategic-page">
    <div className="strategic-head"><div><span>CRM / Customer 360</span><h1>Клиенты 360°</h1><p>Профиль объединяется только по валидному телефону, email или явной связи call → lead. История касаний берётся из канонического Patient Journey Growth Engine.</p></div><button className="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Обновление…' : 'Обновить'}</button></div>
    {message && <div className="alert alert--error">{message}</div>}
    {loading ? <div className="suite-state">Загружаем клиентскую историю…</div> : <div className="customer-layout">
      <section className="panel"><label className="ads-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Имя, телефон, email, источник, менеджер"/></label><div className="customer-list">{visibleCustomers.map(customer => <button key={customer.key} className={`customer-row ${current?.key === customer.key ? 'active' : ''}`} onClick={() => selectCustomer(customer.key)}><div><b>{customer.latest.name || customer.latest.phone || customer.latest.email || 'Без имени'}</b><small>{customer.latest.phone || customer.latest.email || 'Нет контакта'} · {customer.latest.stage || 'Стадия не указана'}</small></div><strong>{money(customer.revenue)}</strong></button>)}{!visibleCustomers.length && <div className="suite-state">Клиенты не найдены.</div>}</div></section>
      <section className="panel customer-profile">{current ? <><div className="customer-profile-head"><div><h2>{current.latest.name || current.latest.phone || current.latest.email || 'Без имени'}</h2><p>{current.latest.phone || 'телефон не указан'} · {current.latest.email || 'email не указан'}</p></div><span className="badge">{current.latest.stage || '—'}</span></div><div className="customer-facts"><div><span>Лидов</span><b>{current.items.length}</b></div><div><span>Звонков</span><b>{relatedCalls.length}</b></div><div><span>Выручка</span><b>{money(current.revenue)}</b></div><div><span>Менеджер</span><b>{current.latest.manager || 'Не назначен'}</b></div></div><div className="customer-facts"><div><span>Первый источник</span><b>{[...current.items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]?.source || [...current.items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]?.platform || '—'}</b></div><div><span>Последний источник</span><b>{current.latest.source || current.latest.platform || '—'}</b></div><div><span>UTM campaign</span><b>{current.latest.utm_campaign || '—'}</b></div><div><span>Продаж</span><b>{current.items.filter(item => Number(item.sale_amount || 0) > 0 || Boolean(item.sold_at)).length}</b></div></div><div><h3>Patient Journey</h3><div className="timeline">{timeline.map((item, index) => <div className="timeline-item" key={`${item.date}-${index}`}><i/><div><b>{item.title}</b><p>{item.text} · {item.date ? new Date(item.date).toLocaleString('ru-RU') : '—'}</p></div></div>)}</div></div></> : <div className="suite-state">Клиентов пока нет.</div>}</section>
    </div>}
  </div>;
}
