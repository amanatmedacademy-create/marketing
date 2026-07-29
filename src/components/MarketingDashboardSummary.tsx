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

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const moneyKzt = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const moneyAd = (value: number, currency: string) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
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
    ])
      .then(([dailyRows, sourceRows, leadRows, adRows, currencyRows]) => {
        if (!active) return;
        setDaily(dailyRows);
        setSources(sourceRows);
        setLeads(leadRows);
        setAds(adRows);
        setCurrencies(currencyRows.accounts);
        setError(null);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const totals = useMemo(() => daily.reduce((acc, row) => ({
    leads: acc.leads + Number(row.leads || 0),
    target: acc.target + Number(row.target_leads || 0),
    arrived: acc.arrived + Number(row.arrived || 0),
    sales: acc.sales + Number(row.sales || 0),
    revenue: acc.revenue + Number(row.revenue || 0),
  }), { leads: 0, target: 0, arrived: 0, sales: 0, revenue: 0 }), [daily]);

  const currencyByAccount = useMemo(() => new Map(
    currencies.map((item) => [`${platformName(item.platform)}:${String(item.account_id).replace(/^act_/, '')}`, item.currency.toUpperCase()]),
  ), [currencies]);

  const currenciesByPlatform = useMemo(() => {
    const result = new Map<string, Set<string>>();
    currencies.forEach((item) => {
      const platform = platformName(item.platform);
      const set = result.get(platform) || new Set<string>();
      set.add(item.currency.toUpperCase());
      result.set(platform, set);
    });
    return result;
  }, [currencies]);

  const spendByCurrency = useMemo(() => {
    const result = new Map<string, number>();
    ads.forEach((row) => {
      const platform = platformName(row.platform);
      const accountId = String(row.account_id || '').replace(/^act_/, '');
      const accountCurrency = accountId ? currencyByAccount.get(`${platform}:${accountId}`) : undefined;
      const platformSet = currenciesByPlatform.get(platform);
      const fallbackCurrency = platformSet?.size === 1 ? [...platformSet][0] : undefined;
      const currency = accountCurrency || fallbackCurrency || 'USD';
      result.set(currency, (result.get(currency) || 0) + Number(row.spend || 0));
    });
    return [...result.entries()].map(([currency, spend]) => ({ currency, spend })).sort((a, b) => a.currency.localeCompare(b.currency));
  }, [ads, currencyByAccount, currenciesByPlatform]);

  const spendLabel = spendByCurrency.length
    ? spendByCurrency.map((item) => moneyAd(item.spend, item.currency)).join(' + ')
    : 'Нет данных';

  const costLabel = (denominator: number) => {
    if (!denominator || !spendByCurrency.length) return '—';
    return spendByCurrency.map((item) => moneyAd(item.spend / denominator, item.currency)).join(' + ');
  };

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
  const averageCheck = totals.sales ? totals.revenue / totals.sales : 0;
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

  if (loading) return <section className="panel"><h2>Загрузка</h2><p className="note">Формируем управленческий дашборд.</p></section>;
  if (error) return <section className="panel"><h2>Ошибка подключения</h2><p className="note">{error}</p></section>;

  return <div className="stack marketing-dashboard-summary">
    <div className="heading"><span>1.6 Dashboard Marketing</span><h1>Дашборд маркетинга</h1><p>Полная сводка по лидам, воронке, конверсиям, потерям, стоимости привлечения и выручке.</p></div>

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
      <article><span>Лид → целевой</span><strong>{percent(totals.target, totals.leads)}</strong><small>{number(totals.target)} из {number(totals.leads)}</small></article>
      <article><span>Целевой → запись</span><strong>{percent(appointments, totals.target)}</strong><small>{number(appointments)} из {number(totals.target)}</small></article>
      <article><span>Запись → приход</span><strong>{percent(totals.arrived, appointments)}</strong><small>{number(totals.arrived)} из {number(appointments)}</small></article>
      <article><span>Приход → продажа</span><strong>{percent(totals.sales, totals.arrived)}</strong><small>{number(totals.sales)} из {number(totals.arrived)}</small></article>
      <article><span>Целевой → продажа</span><strong>{percent(totals.sales, totals.target)}</strong><small>Итоговая конверсия</small></article>
      <article><span>Запись → продажа</span><strong>{percent(totals.sales, appointments)}</strong><small>Эффективность записей</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Рекламный расход</span><strong>{spendLabel}</strong><small>Каждая валюта считается отдельно</small></article>
      <article><span>CPL</span><strong>{costLabel(totals.leads)}</strong><small>Расход / все лиды</small></article>
      <article><span>Стоимость целевого</span><strong>{costLabel(totals.target)}</strong><small>Расход / целевые лиды</small></article>
      <article><span>Стоимость записи</span><strong>{costLabel(appointments)}</strong><small>Расход / записи</small></article>
      <article><span>Стоимость прихода</span><strong>{costLabel(totals.arrived)}</strong><small>Расход / пришедшие</small></article>
      <article><span>CAC</span><strong>{costLabel(totals.sales)}</strong><small>Расход / продажи</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Выручка</span><strong>{moneyKzt(totals.revenue)}</strong><small>CRM, тенге</small></article>
      <article><span>Средний чек</span><strong>{moneyKzt(averageCheck)}</strong><small>Выручка / продажи</small></article>
      <article><span>ROAS</span><strong>Не рассчитывается</strong><small>Сначала нужен курс USD/EUR → KZT</small></article>
      <article><span>ROMI</span><strong>Не рассчитывается</strong><small>Нельзя делить KZT на USD/EUR</small></article>
      <article><span>Доход на лид</span><strong>{moneyKzt(totals.leads ? totals.revenue / totals.leads : 0)}</strong><small>Выручка / лиды</small></article>
      <article><span>Доход на приход</span><strong>{moneyKzt(totals.arrived ? totals.revenue / totals.arrived : 0)}</strong><small>Выручка / пришедшие</small></article>
    </section>

    <section className="dashboard-chart-grid dashboard-chart-grid--hero">
      <article className="panel dashboard-chart-card dashboard-chart-card--wide"><header><div><h2>Динамика воронки</h2><p>Лиды, целевые обращения, приходы и продажи по дням</p></div></header><div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 12, right: 16, left: -12, bottom: 0 }}><defs><linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.45}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="date" stroke="#64748b" tickLine={false}/><YAxis stroke="#64748b" tickLine={false}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }}/><Legend/><Area type="monotone" dataKey="leads" name="Все лиды" stroke="#2563eb" fill="url(#leadsGradient)" strokeWidth={3}/><Area type="monotone" dataKey="target" name="Целевые" stroke="#06b6d4" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="arrived" name="Пришли" stroke="#8b5cf6" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="sales" name="Продажи" stroke="#22c55e" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer></div></article>
      <article className="panel dashboard-chart-card"><header><div><h2>Полная воронка</h2><p>От общего лида до продажи</p></div></header><div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><FunnelChart><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown) => number(Number(value))}/><Funnel dataKey="value" data={funnel} isAnimationActive><LabelList position="right" fill="#e5edf8" stroke="none" dataKey="name"/><LabelList position="center" fill="#fff" stroke="none" dataKey="value" formatter={(value: unknown) => number(Number(value))}/></Funnel></FunnelChart></ResponsiveContainer></div></article>
    </section>

    <section className="dashboard-chart-grid">
      <article className="panel dashboard-chart-card"><header><div><h2>Распределение лидов</h2><p>Доля ведущих источников</p></div></header><div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sourceChart} dataKey="leads" nameKey="name" innerRadius={66} outerRadius={104} paddingAngle={3}>{sourceChart.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[index % palette.length]}/>)}</Pie><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown) => number(Number(value))}/><Legend verticalAlign="bottom" height={54}/></PieChart></ResponsiveContainer></div></article>
      <article className="panel dashboard-chart-card"><header><div><h2>Потери и незакрытые лиды</h2><p>Причины выпадения из воронки</p></div></header><div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={losses} dataKey="value" nameKey="name" innerRadius={58} outerRadius={103} paddingAngle={3}>{losses.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[(index + 2) % palette.length]}/>)}</Pie><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown) => number(Number(value))}/><Legend verticalAlign="bottom" height={54}/></PieChart></ResponsiveContainer></div></article>
      <article className="panel dashboard-chart-card"><header><div><h2>Расход по валютам</h2><p>Без сложения USD, EUR и других валют</p></div></header><div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={spendByCurrency} margin={{ top: 18, right: 20, left: 5, bottom: 18 }}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="currency" stroke="#94a3b8"/><YAxis stroke="#64748b" tickFormatter={(value: unknown) => number(Number(value))}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown, _name: unknown, item: { payload?: { currency?: string } }) => moneyAd(Number(value), item.payload?.currency || 'USD')}/><Bar dataKey="spend" name="Расход" fill="#f59e0b" radius={[6, 6, 0, 0]}/></BarChart></ResponsiveContainer></div><div className="dashboard-finance-strip"><span>Выручка CRM <b>{moneyKzt(totals.revenue)}</b></span><span>Валюты рекламы <b>{spendByCurrency.map((item) => item.currency).join(', ') || 'Нет данных'}</b></span></div></article>
    </section>

    <section className="panel dashboard-chart-card"><header><div><h2>Источники: полный путь лида</h2><p>Лиды, целевые, приходы и продажи по каналам</p></div></header><div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><BarChart data={sourceChart} margin={{ top: 10, right: 10, left: -12, bottom: 45 }}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="name" stroke="#64748b" tickLine={false} angle={-18} textAnchor="end" height={72}/><YAxis stroke="#64748b" tickLine={false}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }}/><Legend/><Bar dataKey="leads" name="Лиды" fill="#2563eb" radius={[4, 4, 0, 0]}/><Bar dataKey="target" name="Целевые" fill="#06b6d4" radius={[4, 4, 0, 0]}/><Bar dataKey="arrived" name="Пришли" fill="#8b5cf6" radius={[4, 4, 0, 0]}/><Bar dataKey="sales" name="Продажи" fill="#22c55e" radius={[4, 4, 0, 0]}/></BarChart></ResponsiveContainer></div></section>

    <section className="panel"><h2>Рекламные кабинеты и валюты</h2><div className="table-wrap"><table><thead><tr><th>Платформа</th><th>Кабинет</th><th>ID</th><th>Валюта</th></tr></thead><tbody>{currencies.length ? currencies.map((row) => <tr key={`${row.platform}-${row.account_id}`}><td><b>{row.platform}</b></td><td>{row.account_name || 'Без названия'}</td><td>{row.account_id}</td><td><b>{row.currency}</b></td></tr>) : <tr><td colSpan={4}>Валюты кабинетов пока не получены</td></tr>}</tbody></table></div></section>

    <section className="panel"><h2>Источники и конверсии</h2><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Конв. в целевой</th><th>Пришли</th><th>Конв. в приход</th><th>Продажи</th><th>Лид → продажа</th><th>Расход</th><th>CPL</th><th>CAC</th><th>Выручка</th><th>ROAS</th></tr></thead><tbody>{sources.map((row) => { const platform = platformName(row.platform); const platformSet = currenciesByPlatform.get(platform); const currency = platformSet?.size === 1 ? [...platformSet][0] : null; return <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{percent(row.target_leads, row.leads)}</td><td>{number(row.arrived)}</td><td>{percent(row.arrived, row.target_leads)}</td><td>{number(row.sales)}</td><td>{percent(row.sales, row.leads)}</td><td>{currency ? moneyAd(row.spend, currency) : row.spend ? 'Разные валюты' : '—'}</td><td>{currency && row.leads ? moneyAd(row.spend / row.leads, currency) : '—'}</td><td>{currency && row.sales ? moneyAd(row.spend / row.sales, currency) : '—'}</td><td>{moneyKzt(row.revenue)}</td><td>—</td></tr>; })}</tbody></table></div></section>
  </div>;
}
