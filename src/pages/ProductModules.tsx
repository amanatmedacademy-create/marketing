import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, CircleDollarSign, Goal, RefreshCw, UsersRound } from 'lucide-react';
import { convertCurrency, formatCurrency } from '../currency';
import { marketingApi, type AdSummaryRow, type AdvertisingAccountCurrency, type DashboardDailyRow, type IntegrationStatus, type MarketingLead, type SourceSummaryRow } from '../services/api';
import '../product-modules.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => formatCurrency(Number(value || 0), 'KZT');
const percent = (value: number, total: number) => total ? `${Math.round((value / total) * 100)}%` : '0%';
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const canonicalStage = (value?: string | null) => {
  const stage = normalize(value);
  if (['new', 'новый'].includes(stage)) return 'new';
  if (stage.includes('квалиф')) return 'qualification';
  if (stage.includes('запис') || stage.includes('appointment')) return 'appointment';
  if (stage.includes('приш') || stage.includes('диагност')) return 'arrival';
  if (stage.includes('продаж') || stage.includes('оплачен') || stage.includes('course')) return 'sale';
  if (stage.includes('отказ') || stage.includes('потер') || stage.includes('lost')) return 'lost';
  return stage;
};
const platformName = (value?: string | null) => normalize(value).includes('tiktok') ? 'TikTok' : normalize(value).includes('meta') || normalize(value).includes('facebook') || normalize(value).includes('instagram') ? 'Meta' : String(value || 'Не определено');

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
    { name: 'Новые лиды', description: 'Лиды на стадии «Новый»', rows: data.filter(item => canonicalStage(item.stage) === 'new') },
    { name: 'Не дозвонились', description: 'Стадия или следующее действие указывает на недозвон', rows: data.filter(item => `${item.stage} ${item.next_action || ''}`.toLowerCase().includes('дозвон')) },
    { name: 'Записаны', description: 'Есть дата записи или стадия записи', rows: data.filter(item => Boolean(item.appointment_at) || canonicalStage(item.stage) === 'appointment') },
    { name: 'Не пришли / отменили', description: 'Отмена, неявка или потерянный лид после записи', rows: data.filter(item => ['не приш', 'неяв', 'отмен'].some(value => normalize(item.stage).includes(value))) },
    { name: 'Покупатели', description: 'Зафиксирована продажа или сумма продажи', rows: data.filter(item => Boolean(item.sold_at) || Number(item.sale_amount || 0) > 0 || canonicalStage(item.stage) === 'sale') },
    { name: 'Без менеджера', description: 'Лиды без назначенного ответственного', rows: data.filter(item => !item.manager) },
  ], [data]);

  return <div className="stack product-module-page">
    <ModuleHeader eyebrow="Audience management" title="Сегменты" text="Динамические аудитории рассчитываются из текущих CRM-данных без тестовых значений." action={<button className="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>{loading ? 'Пересчёт…' : 'Пересчитать'}</button>} />
    {error && <div className="alert alert--error">{error}</div>}
    {loading ? <EmptyState text="Пересчитываем сегменты…"/> : <div className="segment-grid">{segments.map(segment => <article className="segment-card" key={segment.name}><div><span>Динамический сегмент</span><h2>{segment.name}</h2><p>{segment.description}</p></div><footer><strong>{number(segment.rows.length)}</strong><small>{percent(segment.rows.length, data.length)} базы</small></footer></article>)}</div>}
  </div>;
}

export function GoalsPage() {
  const [daily, setDaily] = useState<DashboardDailyRow[]>([]);
  const [sources, setSources] = useState<SourceSummaryRow[]>([]);
  const [ads, setAds] = useState<AdSummaryRow[]>([]);
  const [currencies, setCurrencies] = useState<AdvertisingAccountCurrency[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({ KZT: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [a,b,c,d,e] = await Promise.all([
        marketingApi.dashboard(), marketingApi.sources(), marketingApi.ads(),
        marketingApi.adCurrencies().catch(() => ({ accounts: [] })),
        marketingApi.exchangeRates().catch(() => ({ base: 'KZT' as const, rates: { KZT: 1 }, updatedAt: null })),
      ]);
      setDaily(a); setSources(b); setAds(c); setCurrencies(d.accounts); setRates({ ...e.rates, KZT: 1 });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить показатели'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => daily.reduce((acc,row) => ({ leads:acc.leads+Number(row.leads||0), target:acc.target+Number(row.target_leads||0), arrived:acc.arrived+Number(row.arrived||0), sales:acc.sales+Number(row.sales||0), revenue:acc.revenue+Number(row.revenue||0) }), {leads:0,target:0,arrived:0,sales:0,revenue:0}), [daily]);
  const currencyByAccount = useMemo(() => new Map(currencies.map(item => [`${platformName(item.platform)}:${String(item.account_id).replace(/^act_/, '')}`, item.currency.toUpperCase()])), [currencies]);
  const platformCurrency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    currencies.forEach(item => { const key = platformName(item.platform); const set = map.get(key) || new Set<string>(); set.add(item.currency.toUpperCase()); map.set(key, set); });
    return new Map([...map.entries()].map(([key, set]) => [key, set.size === 1 ? [...set][0] : null]));
  }, [currencies]);
  const spendKzt = useMemo(() => ads.reduce((sum, row) => {
    const platform = platformName(row.platform);
    const accountId = String(row.account_id || '').replace(/^act_/, '');
    const currency = currencyByAccount.get(`${platform}:${accountId}`) || platformCurrency.get(platform);
    if (!currency) return sum;
    return sum + (convertCurrency(Number(row.spend || 0), currency, 'KZT', rates) || 0);
  }, 0), [ads, currencyByAccount, platformCurrency, rates]);
  const conversion = totals.leads ? totals.sales / totals.leads * 100 : 0;
  const roas = spendKzt ? totals.revenue / spendKzt : 0;

  return <div className="stack product-module-page">
    <ModuleHeader eyebrow="Plan / Fact" title="Цели и эффективность" text="Фактические CRM-показатели и рекламный расход, приведённый к KZT по валюте каждого рекламного кабинета." action={<button className="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>{loading ? 'Обновление…' : 'Обновить'}</button>} />
    {error && <div className="alert alert--error">{error}</div>}
    <div className="product-kpis product-kpis--six"><article><Goal/><span>Лиды</span><strong>{loading?'—':number(totals.leads)}</strong></article><article><CheckCircle2/><span>Целевые</span><strong>{loading?'—':number(totals.target)}</strong></article><article><UsersRound/><span>Пришли</span><strong>{loading?'—':number(totals.arrived)}</strong></article><article><CircleDollarSign/><span>Продажи</span><strong>{loading?'—':number(totals.sales)}</strong></article><article><span>Конверсия лид → продажа</span><strong>{loading?'—':`${conversion.toFixed(1)}%`}</strong></article><article><span>ROAS</span><strong>{loading?'—':spendKzt?`${roas.toFixed(2)}x`:'—'}</strong><small>{loading?'':spendKzt?`Расход ${money(spendKzt)}`:'Нет валюты рекламных кабинетов'}</small></article></div>
    {!loading && <section className="panel"><h2>CRM-эффективность по источникам</h2>{sources.length===0?<EmptyState text="Нет данных по источникам."/>:<div className="table-wrap"><table><thead><tr><th>Источник</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Выручка CRM</th></tr></thead><tbody>{sources.map(row => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b><small>{row.platform}</small></td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{number(row.arrived)}</td><td>{number(row.sales)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div>}</section>}
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
    <ModuleHeader eyebrow="Control center" title="Уведомления" text="Системные события из текущего состояния интеграций и последних синхронизаций." action={<button className="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>{loading ? 'Проверка…' : 'Проверить'}</button>} />
    {error && <div className="alert alert--error">{error}</div>}
    {loading ? <EmptyState text="Проверяем состояние системы…"/> : notifications.length===0 ? <EmptyState text="Новых системных событий нет."/> : <div className="notification-list">{notifications.map((item,index) => <article className={`notification-item notification-item--${item.tone}`} key={`${item.title}-${index}`}>{item.tone==='warn'?<AlertTriangle/>:<BellRing/>}<div><b>{item.title}</b><p>{item.text}</p></div></article>)}</div>}
  </div>;
}
