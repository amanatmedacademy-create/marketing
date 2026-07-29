import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${(value * 100 / total).toFixed(1)}%` : '0%';
const palette = ['#2563eb', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444'];
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const hasAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));
const platformName = (value?: string | null) => normalize(value).includes('tiktok') ? 'TikTok' : normalize(value).includes('meta') || normalize(value).includes('facebook') || normalize(value).includes('instagram') ? 'Meta' : String(value || 'Не определено');

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

  const convert = (amount: number, from: string) => convertCurrency(amount, from, displayCurrency, rates);
  const formatConverted = (amount: number, from: string) => {
    const converted = convert(amount, from);
    return converted === null ? 'Курс недоступен' : formatCurrency(converted, displayCurrency);
  };

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
    const result = { appointments: 0, nonTarget: 0, noContact: 0, refused: 0, cancelled: 0, noShow: 0, open: 0 };
    leads.forEach((lead) => {
      const stage = normalize(lead.stage);
      if (lead.appointment_at) result.appointments += 1;
      if (lead.is_target === false || hasAny(stage, ['нецел', 'не цел'])) result.nonTarget += 1;
      if (hasAny(stage, ['не дозвон', 'недозвон', 'нет ответа', 'не отвечает', 'молчит'])) result.noContact += 1;
      if (hasAny(stage, ['отказ', 'отказался', 'не интересно', 'не готов'])) result.refused += 1;
      if (hasAny(stage, ['отмен', 'отмена записи'])) result.cancelled += 1;
      if (hasAny(stage, ['не приш', 'неяв', 'no show'])) result.noShow += 1;
      if (!lead.sold_at && !lead.arrived_at && !hasAny(stage, ['отказ', 'отмен', 'не приш', 'нецел', 'не цел'])) result.open += 1;
    });
    return result;
  }, [leads]);

  const appointments = leadStats.appointments;
  const averageCheck = totals.sales ? revenue / totals.sales : 0;
  const roas = adSpend ? revenue / adSpend : 0;
  const romi = adSpend ? ((revenue - adSpend) / adSpend) * 100 : 0;
  const trend = useMemo(() => daily.map((row) => ({ date: String(row.date || '').slice(5) || '—', leads: Number(row.leads || 0), target: Number(row.target_leads || 0), arrived: Number(row.arrived || 0), sales: Number(row.sales || 0) })), [daily]);
  const funnel = useMemo(() => [
    { name: 'Все лиды', value: totals.leads, fill: '#2563eb' },
    { name: 'Целевые', value: totals.target, fill: '#06b6d4' },
    { name: 'Записаны', value: appointments, fill: '#f59e0b' },
    { name: 'Пришли', value: totals.arrived, fill: '#8b5cf6' },
    { name: 'Продажи', value: totals.sales, fill: '#22c55e' },
  ], [totals, appointments]);
  const sourceChart = useMemo(() => sources.filter((row) => Number(row.leads || 0) > 0).sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0)).slice(0, 8).map((row) => ({ name: row.source || row.platform || 'Без источника', leads: Number(row.leads || 0), target: Number(row.target_leads || 0), arrived: Number(row.arrived || 0), sales: Number(row.sales || 0) })), [sources]);
  const losses = [
    { name: 'Нецелевые', value: leadStats.nonTarget },
    { name: 'Не дозвонились', value: leadStats.noContact },
    { name: 'Отказались', value: leadStats.refused },
    { name: 'Отменили', value: leadStats.cancelled },
    { name: 'Не пришли', value: leadStats.noShow },
    { name: 'В работе', value: leadStats.open },
  ].filter((item) => item.value > 0);
  const financial = [{ name: 'Расход', value: adSpend }, { name: 'Выручка', value: revenue }];

  if (loading) return <section className="panel"><h2>Загрузка</h2><p className="note">Формируем управленческий дашборд.</p></section>;
  if (error) return <section className="panel"><h2>Ошибка подключения</h2><p className="note">{error}</p></section>;

  return <div className="stack marketing-dashboard-summary">
    <div className="heading"><span>1.6 Dashboard Marketing</span><h1>Дашборд маркетинга</h1><p>Все денежные показатели отображаются в {displayCurrency}. Валюта рекламных кабинетов определяется автоматически.</p></div>

    <section className="marketing-kpis">
      <article><span>Все лиды</span><strong>{number(totals.leads)}</strong><small>Общий входящий поток</small></article>
      <article><span>Целевые лиды</span><strong>{number(totals.target)}</strong><small>{percent(totals.target, totals.leads)} от всех</small></article>
      <article><span>Записаны</span><strong>{number(appointments)}</strong><small>{percent(appointments, totals.target)} от целевых</small></article>
      <article><span>Пришли</span><strong>{number(totals.arrived)}</strong><small>{percent(totals.arrived, appointments || totals.target)} от записанных</small></article>
      <article><span>Продажи</span><strong>{number(totals.sales)}</strong><small>{percent(totals.sales, totals.arrived)} от пришедших</small></article>
      <article><span>Лид → продажа</span><strong>{percent(totals.sales, totals.leads)}</strong><small>{number(totals.sales)} из {number(totals.leads)}</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Нецелевые</span><strong>{number(leadStats.nonTarget)}</strong><small>{percent(leadStats.nonTarget, totals.leads)}</small></article>
      <article><span>Не дозвонились</span><strong>{number(leadStats.noContact)}</strong><small>{percent(leadStats.noContact, totals.leads)}</small></article>
      <article><span>Отказались</span><strong>{number(leadStats.refused)}</strong><small>{percent(leadStats.refused, totals.leads)}</small></article>
      <article><span>Отменили запись</span><strong>{number(leadStats.cancelled)}</strong><small>{percent(leadStats.cancelled, appointments)}</small></article>
      <article><span>Не пришли</span><strong>{number(leadStats.noShow)}</strong><small>{percent(leadStats.noShow, appointments)}</small></article>
      <article><span>В работе</span><strong>{number(leadStats.open)}</strong><small>Без закрывающего статуса</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Рекламный расход</span><strong>{formatCurrency(adSpend, displayCurrency)}</strong><small>После конвертации</small></article>
      <article><span>CPL</span><strong>{formatCurrency(totals.leads ? adSpend / totals.leads : 0, displayCurrency)}</strong><small>Расход / лиды</small></article>
      <article><span>Стоимость целевого</span><strong>{formatCurrency(totals.target ? adSpend / totals.target : 0, displayCurrency)}</strong><small>Расход / целевые</small></article>
      <article><span>Стоимость записи</span><strong>{formatCurrency(appointments ? adSpend / appointments : 0, displayCurrency)}</strong><small>Расход / записи</small></article>
      <article><span>Стоимость прихода</span><strong>{formatCurrency(totals.arrived ? adSpend / totals.arrived : 0, displayCurrency)}</strong><small>Расход / пришедшие</small></article>
      <article><span>CAC</span><strong>{formatCurrency(totals.sales ? adSpend / totals.sales : 0, displayCurrency)}</strong><small>Расход / продажи</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Выручка</span><strong>{formatCurrency(revenue, displayCurrency)}</strong><small>CRM, конвертировано из KZT</small></article>
      <article><span>Средний чек</span><strong>{formatCurrency(averageCheck, displayCurrency)}</strong><small>Выручка / продажи</small></article>
      <article><span>ROAS</span><strong>{roas.toFixed(2)}x</strong><small>После приведения к одной валюте</small></article>
      <article><span>ROMI</span><strong>{romi.toFixed(1)}%</strong><small>До операционных расходов</small></article>
      <article><span>Доход на лид</span><strong>{formatCurrency(totals.leads ? revenue / totals.leads : 0, displayCurrency)}</strong><small>Выручка / лиды</small></article>
      <article><span>Доход на приход</span><strong>{formatCurrency(totals.arrived ? revenue / totals.arrived : 0, displayCurrency)}</strong><small>Выручка / пришедшие</small></article>
    </section>

    <section className="dashboard-chart-grid dashboard-chart-grid--hero">
      <article className="panel dashboard-chart-card dashboard-chart-card--wide"><header><div><h2>Динамика воронки</h2><p>Лиды, целевые, приходы и продажи по дням</p></div></header><div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="date" stroke="#64748b"/><YAxis stroke="#64748b"/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }}/><Legend/><Area type="monotone" dataKey="leads" name="Лиды" stroke="#2563eb" fill="#2563eb33"/><Area type="monotone" dataKey="target" name="Целевые" stroke="#06b6d4" fill="transparent"/><Area type="monotone" dataKey="arrived" name="Пришли" stroke="#8b5cf6" fill="transparent"/><Area type="monotone" dataKey="sales" name="Продажи" stroke="#22c55e" fill="transparent"/></AreaChart></ResponsiveContainer></div></article>
      <article className="panel dashboard-chart-card"><header><div><h2>Полная воронка</h2><p>От лида до продажи</p></div></header><div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><FunnelChart><Tooltip formatter={(value: unknown) => number(Number(value))}/><Funnel dataKey="value" data={funnel}><LabelList position="right" dataKey="name" fill="#e5edf8"/><LabelList position="center" dataKey="value" fill="#fff" formatter={(value: unknown) => number(Number(value))}/></Funnel></FunnelChart></ResponsiveContainer></div></article>
    </section>

    <section className="dashboard-chart-grid">
      <article className="panel dashboard-chart-card"><header><div><h2>Распределение лидов</h2><p>По ведущим источникам</p></div></header><div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sourceChart} dataKey="leads" nameKey="name" innerRadius={66} outerRadius={104}>{sourceChart.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[index % palette.length]}/>)}</Pie><Tooltip formatter={(value: unknown) => number(Number(value))}/><Legend/></PieChart></ResponsiveContainer></div></article>
      <article className="panel dashboard-chart-card"><header><div><h2>Потери</h2><p>Причины выпадения</p></div></header><div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={losses} dataKey="value" nameKey="name" innerRadius={58} outerRadius={103}>{losses.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[(index + 2) % palette.length]}/>)}</Pie><Tooltip formatter={(value: unknown) => number(Number(value))}/><Legend/></PieChart></ResponsiveContainer></div></article>
      <article className="panel dashboard-chart-card"><header><div><h2>Финансовый результат</h2><p>В валюте {displayCurrency}</p></div></header><div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={financial} layout="vertical"><CartesianGrid stroke="#1e2d4a" horizontal={false}/><XAxis type="number" stroke="#64748b"/><YAxis type="category" dataKey="name" stroke="#94a3b8" width={70}/><Tooltip formatter={(value: unknown) => formatCurrency(Number(value), displayCurrency)}/><Bar dataKey="value" radius={[0, 7, 7, 0]}>{financial.map((entry, index) => <Cell key={entry.name} fill={index === 0 ? '#f59e0b' : '#22c55e'}/>)}</Bar></BarChart></ResponsiveContainer></div></article>
    </section>

    <section className="panel"><h2>Рекламные кабинеты и исходные валюты</h2><div className="table-wrap"><table><thead><tr><th>Платформа</th><th>Кабинет</th><th>ID</th><th>Исходная валюта</th><th>Показывается в</th></tr></thead><tbody>{currencies.length ? currencies.map((row) => <tr key={`${row.platform}-${row.account_id}`}><td><b>{row.platform}</b></td><td>{row.account_name || 'Без названия'}</td><td>{row.account_id}</td><td><b>{row.currency}</b></td><td><b>{displayCurrency}</b></td></tr>) : <tr><td colSpan={5}>Валюты кабинетов пока не получены</td></tr>}</tbody></table></div></section>

    <section className="panel"><h2>Источники и конверсии</h2><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Конверсия</th><th>Расход</th><th>CPL</th><th>CAC</th><th>Выручка</th></tr></thead><tbody>{sources.map((row) => { const native = platformCurrency.get(platformName(row.platform)); const convertedSpend = native ? convert(Number(row.spend || 0), native) : null; const convertedRevenue = convert(Number(row.revenue || 0), 'KZT'); return <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{number(row.arrived)}</td><td>{number(row.sales)}</td><td>{percent(row.sales, row.leads)}</td><td>{convertedSpend === null ? '—' : formatCurrency(convertedSpend, displayCurrency)}</td><td>{convertedSpend === null || !row.leads ? '—' : formatCurrency(convertedSpend / row.leads, displayCurrency)}</td><td>{convertedSpend === null || !row.sales ? '—' : formatCurrency(convertedSpend / row.sales, displayCurrency)}</td><td>{convertedRevenue === null ? '—' : formatCurrency(convertedRevenue, displayCurrency)}</td></tr>; })}</tbody></table></div></section>
  </div>;
}
