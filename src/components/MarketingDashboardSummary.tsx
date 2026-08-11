import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  DollarSign,
  Sparkles,
  Target,
  UsersRound,
} from 'lucide-react';
import {
  marketingApi,
  type AdSummaryRow,
  type AdvertisingAccountCurrency,
  type DashboardDailyRow,
  type MarketingLead,
  type SourceSummaryRow,
} from '../services/api';
import {
  DISPLAY_CURRENCY_EVENT,
  convertCurrency,
  formatCurrency,
  readDisplayCurrency,
  type DisplayCurrency,
} from '../currency';
import DashboardCsvExport from './DashboardCsvExport';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${(value * 100 / total).toFixed(1)}%` : '0%';
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const hasAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));
const platformName = (value?: string | null) => normalize(value).includes('tiktok') ? 'TikTok' : normalize(value).includes('meta') || normalize(value).includes('facebook') || normalize(value).includes('instagram') ? 'Meta' : String(value || 'Не определено');
const trendDelta = (first: number, last: number) => first ? ((last - first) / Math.abs(first)) * 100 : 0;

export default function MarketingDashboardSummary() {
  const [daily, setDaily] = useState<DashboardDailyRow[]>([]);
  const [sources, setSources] = useState<SourceSummaryRow[]>([]);
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [ads, setAds] = useState<AdSummaryRow[]>([]);
  const [currencies, setCurrencies] = useState<AdvertisingAccountCurrency[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({ KZT: 1 });
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => readDisplayCurrency());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      marketingApi.dashboard(),
      marketingApi.sources(),
      marketingApi.listLeads({ limit: 5000 }),
      marketingApi.ads(),
      marketingApi.adCurrencies().catch(() => ({ accounts: [] })),
      marketingApi.exchangeRates().catch(() => ({ base: 'KZT' as const, rates: { KZT: 1 }, updatedAt: null })),
    ])
      .then(([dailyRows, sourceRows, leadRows, adRows, currencyRows, rateRows]) => {
        if (!active) return;
        setDaily(dailyRows);
        setSources(sourceRows);
        setLeads(leadRows);
        setAds(adRows);
        setCurrencies(currencyRows.accounts);
        setRates({ ...rateRows.rates, KZT: 1 });
        setError(null);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));

    const handleCurrency = (event: Event) => setDisplayCurrency((event as CustomEvent<DisplayCurrency>).detail || readDisplayCurrency());
    window.addEventListener(DISPLAY_CURRENCY_EVENT, handleCurrency);
    return () => {
      active = false;
      window.removeEventListener(DISPLAY_CURRENCY_EVENT, handleCurrency);
    };
  }, []);

  const totals = useMemo(() => daily.reduce((acc, row) => ({
    leads: acc.leads + Number(row.leads || 0),
    target: acc.target + Number(row.target_leads || 0),
    arrived: acc.arrived + Number(row.arrived || 0),
    sales: acc.sales + Number(row.sales || 0),
    revenueKzt: acc.revenueKzt + Number(row.revenue || 0),
  }), { leads: 0, target: 0, arrived: 0, sales: 0, revenueKzt: 0 }), [daily]);

  const currencyByAccount = useMemo(() => new Map(
    currencies.map((item) => [`${platformName(item.platform)}:${String(item.account_id).replace(/^act_/, '')}`, item.currency.toUpperCase()]),
  ), [currencies]);

  const platformCurrency = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    currencies.forEach((item) => {
      const key = platformName(item.platform);
      const set = sets.get(key) || new Set<string>();
      set.add(item.currency.toUpperCase());
      sets.set(key, set);
    });
    return new Map([...sets.entries()].map(([key, set]) => [key, set.size === 1 ? [...set][0] : null]));
  }, [currencies]);

  const adSpend = useMemo(() => ads.reduce((sum, row) => {
    const platform = platformName(row.platform);
    const accountId = String(row.account_id || '').replace(/^act_/, '');
    const nativeCurrency = currencyByAccount.get(`${platform}:${accountId}`) || platformCurrency.get(platform);
    if (!nativeCurrency) return sum;
    const converted = convertCurrency(Number(row.spend || 0), nativeCurrency, displayCurrency, rates);
    return converted === null ? sum : sum + converted;
  }, 0), [ads, currencyByAccount, platformCurrency, displayCurrency, rates]);

  const revenue = convertCurrency(totals.revenueKzt, 'KZT', displayCurrency, rates) || 0;

  const leadStats = useMemo(() => {
    const result = { appointments: 0, open: 0 };
    leads.forEach((lead) => {
      const stage = normalize(lead.stage);
      if (lead.appointment_at) result.appointments += 1;
      if (!lead.sold_at && !lead.arrived_at && !hasAny(stage, ['отказ', 'отмен', 'не приш', 'нецел', 'не цел'])) result.open += 1;
    });
    return result;
  }, [leads]);

  const trend = useMemo(() => daily.map((row) => ({
    date: String(row.date || '').slice(5) || '—',
    leads: Number(row.leads || 0),
    target: Number(row.target_leads || 0),
    arrived: Number(row.arrived || 0),
    sales: Number(row.sales || 0),
  })), [daily]);

  const sourceRows = useMemo(() => sources
    .filter((row) => Number(row.leads || 0) > 0)
    .sort((a, b) => Number(b.sales || 0) - Number(a.sales || 0) || Number(b.leads || 0) - Number(a.leads || 0))
    .slice(0, 6)
    .map((row) => ({
      name: row.source || row.platform || 'Без источника',
      platform: row.platform || '—',
      leads: Number(row.leads || 0),
      target: Number(row.target_leads || 0),
      arrived: Number(row.arrived || 0),
      sales: Number(row.sales || 0),
    })), [sources]);

  const firstDay = daily[0];
  const lastDay = daily[daily.length - 1];
  const leadTrend = trendDelta(Number(firstDay?.leads || 0), Number(lastDay?.leads || 0));
  const targetTrend = trendDelta(Number(firstDay?.target_leads || 0), Number(lastDay?.target_leads || 0));
  const salesTrend = trendDelta(Number(firstDay?.sales || 0), Number(lastDay?.sales || 0));
  const roas = adSpend ? revenue / adSpend : 0;
  const cac = totals.sales ? adSpend / totals.sales : 0;
  const cpl = totals.leads ? adSpend / totals.leads : 0;
  const topSource = sourceRows[0];

  const kpis = [
    { label: 'Все лиды', value: number(totals.leads), helper: `${percent(totals.target, totals.leads)} целевых`, trend: leadTrend, icon: UsersRound },
    { label: 'Целевые лиды', value: number(totals.target), helper: `${number(leadStats.appointments)} записей`, trend: targetTrend, icon: Target },
    { label: 'Продажи', value: number(totals.sales), helper: `${percent(totals.sales, totals.leads)} лид → продажа`, trend: salesTrend, icon: BarChart3 },
    { label: 'Выручка', value: formatCurrency(revenue, displayCurrency), helper: `${roas.toFixed(2)}x ROAS`, trend: 0, icon: DollarSign },
  ];

  const pipeline = [
    { label: 'Все лиды', value: totals.leads },
    { label: 'Целевые', value: totals.target },
    { label: 'Записаны', value: leadStats.appointments },
    { label: 'Пришли', value: totals.arrived },
    { label: 'Продажи', value: totals.sales },
  ];

  const recent = [...daily].slice(-5).reverse();

  if (loading) return <section className="panel dashboard-state"><Activity className="spin" size={22}/><div><h2>Формируем Dashboard</h2><p className="note">Собираем CRM, рекламу и финансовые показатели.</p></div></section>;
  if (error) return <section className="panel dashboard-state dashboard-state--error"><div><h2>Не удалось загрузить Dashboard</h2><p className="note">{error}</p></div></section>;

  return <div className="imds-dashboard">
    <header className="imds-dashboard-hero">
      <div>
        <span className="imds-dashboard-eyebrow">IMDS MARKETING</span>
        <h1>Dashboard</h1>
        <p>Единая картина маркетинга, воронки и выручки. Все денежные показатели — в {displayCurrency}.</p>
      </div>
      <div className="imds-dashboard-actions"><DashboardCsvExport /></div>
    </header>

    <section className="imds-executive-kpis">
      {kpis.map(({ label, value, helper, trend: delta, icon: Icon }) => <article className="imds-kpi-card" key={label}>
        <div className="imds-kpi-card__top"><span>{label}</span><span className="imds-kpi-card__icon"><Icon size={19}/></span></div>
        <strong>{value}</strong>
        <div className="imds-kpi-card__footer"><small>{helper}</small>{delta !== 0 && <b className={delta >= 0 ? 'is-positive' : 'is-negative'}><ArrowUpRight size={13}/>{Math.abs(delta).toFixed(1)}%</b>}</div>
      </article>)}
    </section>

    <section className="imds-finance-strip">
      <article><span>Рекламный расход</span><strong>{formatCurrency(adSpend, displayCurrency)}</strong></article>
      <article><span>CPL</span><strong>{formatCurrency(cpl, displayCurrency)}</strong></article>
      <article><span>CAC</span><strong>{formatCurrency(cac, displayCurrency)}</strong></article>
      <article><span>ROAS</span><strong>{roas.toFixed(2)}x</strong></article>
    </section>

    <section className="imds-dashboard-main-grid">
      <article className="panel imds-performance-card">
        <header className="imds-card-heading">
          <div><span>PERFORMANCE</span><h2>Динамика воронки</h2><p>Лиды, целевые и продажи по дням</p></div>
          <div className="imds-chart-legend"><span><i className="legend-primary"/>Лиды</span><span><i className="legend-secondary"/>Целевые</span><span><i className="legend-success"/>Продажи</span></div>
        </header>
        <div className="imds-performance-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="imdsLeadsArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#12b8a5" stopOpacity={0.32}/><stop offset="100%" stopColor="#12b8a5" stopOpacity={0.02}/></linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--imds-chart-grid)"/>
              <XAxis dataKey="date" axisLine={false} tickLine={false}/>
              <YAxis axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: 'var(--imds-surface)', border: '1px solid var(--imds-border)', borderRadius: 12, color: 'var(--imds-text)' }}/>
              <Area type="monotone" dataKey="leads" name="Лиды" stroke="#12b8a5" strokeWidth={2.4} fill="url(#imdsLeadsArea)"/>
              <Area type="monotone" dataKey="target" name="Целевые" stroke="#3f89b6" strokeWidth={2} fill="transparent"/>
              <Area type="monotone" dataKey="sales" name="Продажи" stroke="#36b779" strokeWidth={2} fill="transparent"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="panel imds-pipeline-card">
        <header className="imds-card-heading"><div><span>PIPELINE</span><h2>Воронка продаж</h2><p>Конверсия от входящего лида до продажи</p></div></header>
        <div className="imds-pipeline-list">
          {pipeline.map((item, index) => {
            const width = totals.leads ? Math.max(12, item.value * 100 / totals.leads) : 12;
            const previous = index === 0 ? totals.leads : pipeline[index - 1].value;
            return <div className="imds-pipeline-row" key={item.label}>
              <div><span>{item.label}</span><strong>{number(item.value)}</strong></div>
              <div className="imds-pipeline-track"><i style={{ width: `${width}%` }}/></div>
              <small>{index === 0 ? '100%' : percent(item.value, previous)}</small>
            </div>;
          })}
        </div>
        <footer><span>В работе сейчас</span><strong>{number(leadStats.open)}</strong></footer>
      </article>
    </section>

    <section className="imds-dashboard-lower-grid">
      <article className="panel imds-source-card">
        <header className="imds-card-heading"><div><span>CHANNELS</span><h2>Эффективность источников</h2><p>Топ каналов по продажам и входящему потоку</p></div></header>
        {sourceRows.length === 0 ? <p className="note">Нет данных по источникам.</p> : <div className="table-wrap imds-source-table"><table>
          <thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Конверсия</th></tr></thead>
          <tbody>{sourceRows.map((row) => <tr key={`${row.platform}-${row.name}`}>
            <td><b>{row.name}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.target)}</td><td>{number(row.arrived)}</td><td><strong>{number(row.sales)}</strong></td><td><span className="imds-conversion-badge">{percent(row.sales, row.leads)}</span></td>
          </tr>)}</tbody>
        </table></div>}
      </article>

      <aside className="imds-dashboard-side-stack">
        <article className="panel imds-insight-card">
          <header className="imds-card-heading"><div><span>INSIGHTS</span><h2>Что важно сейчас</h2></div><Sparkles size={19}/></header>
          <div className="imds-insights-list">
            <div><span className="insight-icon"><Target size={16}/></span><p><b>{percent(totals.target, totals.leads)} целевых лидов</b><small>Качество входящего потока за выбранный период.</small></p></div>
            <div><span className="insight-icon"><BarChart3 size={16}/></span><p><b>{percent(totals.sales, totals.arrived)} приход → продажа</b><small>Конверсия после фактического визита.</small></p></div>
            <div><span className="insight-icon"><DollarSign size={16}/></span><p><b>{roas.toFixed(2)}x ROAS</b><small>{roas >= 1 ? 'Рекламная выручка выше рекламного расхода.' : 'Нужно проверить окупаемость рекламных каналов.'}</small></p></div>
            {topSource && <div><span className="insight-icon"><UsersRound size={16}/></span><p><b>{topSource.name}</b><small>Лидирующий источник: {number(topSource.sales)} продаж.</small></p></div>}
          </div>
        </article>

        <article className="panel imds-activity-card">
          <header className="imds-card-heading"><div><span>ACTIVITY</span><h2>Последние дни</h2></div><Activity size={19}/></header>
          <div className="imds-activity-list">{recent.length === 0 ? <p className="note">Нет дневной статистики.</p> : recent.map((row, index) => <div key={`${row.date}-${index}`}>
            <span className="activity-dot"/><p><b>{String(row.date || '').slice(0, 10) || 'Период'}</b><small>{number(Number(row.leads || 0))} лидов · {number(Number(row.sales || 0))} продаж · {number(Number(row.arrived || 0))} пришли</small></p>
          </div>)}</div>
        </article>
      </aside>
    </section>

    {sourceRows.length > 0 && <section className="panel imds-channel-volume-card">
      <header className="imds-card-heading"><div><span>ACQUISITION</span><h2>Объём по каналам</h2><p>Лиды и продажи по основным источникам</p></div></header>
      <div className="imds-channel-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={sourceRows} margin={{ top: 8, right: 8, left: -18, bottom: 10 }}><CartesianGrid vertical={false} stroke="var(--imds-chart-grid)"/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: 'var(--imds-surface)', border: '1px solid var(--imds-border)', borderRadius: 12, color: 'var(--imds-text)' }}/><Bar dataKey="leads" name="Лиды" fill="#12b8a5" radius={[5,5,0,0]}/><Bar dataKey="sales" name="Продажи" fill="#3f89b6" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div>
    </section>}
  </div>;
}
