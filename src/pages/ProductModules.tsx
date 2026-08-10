import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, CircleDollarSign, Goal, RefreshCw, UsersRound } from 'lucide-react';
import { marketingApi, type DashboardDailyRow, type IntegrationStatus, type MarketingLead, type SourceSummaryRow } from '../services/api';
import '../product-modules.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${Math.round((value / total) * 100)}%` : '0%';

function ModuleHeader({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <div className="product-page-head"><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="product-empty">{text}</div>;
}

function useLeads() {
  const [data, setData] = useState<MarketingLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try { setData(await marketingApi.listLeads({ limit: 1000 })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить лиды'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return { data, loading, error, load };
}

export function SegmentsPage() {
  const { data, loading, error, load } = useLeads();
  const segments = useMemo(() => [
    { name: 'Новые лиды', description: 'Лиды на стадии Новый', rows: data.filter(item => item.stage === 'Новый') },
    { name: 'Не дозвонились', description: 'Лиды со стадией или следующим действием, связанным с недозвоном', rows: data.filter(item => `${item.stage} ${item.next_action || ''}`.toLowerCase().includes('дозвон')) },
    { name: 'Записаны', description: 'Есть дата записи или стадия Записан', rows: data.filter(item => Boolean(item.appointment_at) || item.stage === 'Записан') },
    { name: 'Не пришли / отменили', description: 'Отказ, отмена или отсутствие после записи', rows: data.filter(item => ['Отказ','Не пришёл','Отмена'].some(value => item.stage.toLowerCase().includes(value.toLowerCase()))) },
    { name: 'Покупатели', description: 'Есть продажа или сумма продажи', rows: data.filter(item => Boolean(item.sold_at) || Number(item.sale_amount || 0) > 0 || item.stage === 'Продажа') },
    { name: 'Без менеджера', description: 'Лиды, которым не назначен ответственный', rows: data.filter(item => !item.manager) },
  ], [data]);

  return <div className="stack product-module-page">
    <ModuleHeader eyebrow="Audience management" title="Сегменты" text="Динамические аудитории на реальных CRM-данных. Это фундамент для рассылок, ретаргетинга и автоматизаций." action={<button className="button" onClick={() => void load()}><RefreshCw size={16}/>Пересчитать</button>} />
    {error && <div className="alert alert--error">{error}</div>}
    {loading ? <EmptyState text="Пересчитываем сегменты…"/> : <div className="segment-grid">{segments.map(segment => <article className="segment-card" key={segment.name}><div><span>Динамический сегмент</span><h2>{segment.name}</h2><p>{segment.description}</p></div><footer><strong>{number(segment.rows.length)}</strong><small>{percent(segment.rows.length, data.length)} базы</small></footer></article>)}</div>}
  </div>;
}

export function GoalsPage() {
  const [daily, setDaily] = useState<DashboardDailyRow[]>([]);
  const [sources, setSources] = useState<SourceSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try { const [a,b] = await Promise.all([marketingApi.dashboard(), marketingApi.sources()]); setDaily(a); setSources(b); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить показатели'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => daily.reduce((acc,row) => ({ leads:acc.leads+Number(row.leads||0), target:acc.target+Number(row.target_leads||0), arrived:acc.arrived+Number(row.arrived||0), sales:acc.sales+Number(row.sales||0), spend:acc.spend+Number(row.spend||0), revenue:acc.revenue+Number(row.revenue||0) }), {leads:0,target:0,arrived:0,sales:0,spend:0,revenue:0}), [daily]);
  const conversion = totals.leads ? totals.sales / totals.leads * 100 : 0;
  const roas = totals.spend ? totals.revenue / totals.spend : 0;

  return <div className="stack product-module-page">
    <ModuleHeader eyebrow="Plan / Fact" title="Цели и эффективность" text="Текущий факт по маркетингу. Плановые значения будут подключаться отдельной таблицей целей, без подмены реальных данных." action={<button className="button" onClick={() => void load()}><RefreshCw size={16}/>Обновить</button>} />
    {error && <div className="alert alert--error">{error}</div>}
    <div className="product-kpis product-kpis--six"><article><Goal/><span>Лиды</span><strong>{loading?'—':number(totals.leads)}</strong></article><article><CheckCircle2/><span>Целевые</span><strong>{loading?'—':number(totals.target)}</strong></article><article><UsersRound/><span>Пришли</span><strong>{loading?'—':number(totals.arrived)}</strong></article><article><CircleDollarSign/><span>Продажи</span><strong>{loading?'—':number(totals.sales)}</strong></article><article><span>Конверсия лид → продажа</span><strong>{loading?'—':`${conversion.toFixed(1)}%`}</strong></article><article><span>ROAS</span><strong>{loading?'—':`${roas.toFixed(2)}x`}</strong></article></div>
    {!loading && <section className="panel"><h2>Эффективность по источникам</h2>{sources.length===0?<EmptyState text="Нет данных по источникам."/>:<div className="table-wrap"><table><thead><tr><th>Источник</th><th>Лиды</th><th>Продажи</th><th>Расход</th><th>Выручка</th><th>ROAS</th></tr></thead><tbody>{sources.map(row => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b><small>{row.platform}</small></td><td>{number(row.leads)}</td><td>{number(row.sales)}</td><td>{money(row.spend)}</td><td>{money(row.revenue)}</td><td>{row.spend ? (row.revenue/row.spend).toFixed(2)+'x' : '—'}</td></tr>)}</tbody></table></div>}</section>}
  </div>;
}

export function NotificationsPage() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { setLoading(true); setError(null); try { setStatus(await marketingApi.integrationStatus()); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось проверить интеграции'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const notifications = useMemo(() => {
    if (!status) return [];
    const rows: Array<{tone:'ok'|'warn';title:string;text:string}> = [];
    for (const run of status.runs.slice(0,20)) {
      if (run.status === 'failed') rows.push({ tone:'warn', title:`Ошибка синхронизации: ${run.source}`, text: run.error || 'Последний запуск завершился ошибкой.' });
      else if (run.status === 'success') rows.push({ tone:'ok', title:`Синхронизация завершена: ${run.source}`, text:`Получено ${run.fetched}, записано ${run.written}.` });
    }
    return rows;
  }, [status]);

  return <div className="stack product-module-page">
    <ModuleHeader eyebrow="Control center" title="Уведомления" text="Системные события из текущего состояния интеграций и последних синхронизаций." action={<button className="button" onClick={() => void load()}><RefreshCw size={16}/>Проверить</button>} />
    {error && <div className="alert alert--error">{error}</div>}
    {loading ? <EmptyState text="Проверяем состояние системы…"/> : notifications.length===0 ? <EmptyState text="Новых системных событий нет."/> : <div className="notification-list">{notifications.map((item,index) => <article className={`notification-item notification-item--${item.tone}`} key={`${item.title}-${index}`}>{item.tone==='warn'?<AlertTriangle/>:<BellRing/>}<div><b>{item.title}</b><p>{item.text}</p></div></article>)}</div>}
  </div>;
}
