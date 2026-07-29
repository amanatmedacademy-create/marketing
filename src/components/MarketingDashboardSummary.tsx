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
import { marketingApi, type DashboardDailyRow, type SourceSummaryRow } from '../services/api';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${(value * 100 / total).toFixed(1)}%` : '0%';
const palette = ['#2563eb', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

export default function MarketingDashboardSummary() {
  const [daily, setDaily] = useState<DashboardDailyRow[]>([]);
  const [sources, setSources] = useState<SourceSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([marketingApi.dashboard(), marketingApi.sources()])
      .then(([dailyRows, sourceRows]) => {
        if (!active) return;
        setDaily(dailyRows);
        setSources(sourceRows);
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
    spend: acc.spend + Number(row.spend || 0),
    revenue: acc.revenue + Number(row.revenue || 0),
  }), { leads: 0, target: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 }), [daily]);

  const trend = useMemo(() => daily.map((row) => ({
    date: String(row.date || '').slice(5) || '—',
    leads: Number(row.leads || 0),
    target: Number(row.target_leads || 0),
    arrived: Number(row.arrived || 0),
    sales: Number(row.sales || 0),
  })), [daily]);

  const funnel = useMemo(() => [
    { name: 'Все лиды', value: totals.leads, fill: '#2563eb' },
    { name: 'Целевые', value: totals.target, fill: '#06b6d4' },
    { name: 'Пришли', value: totals.arrived, fill: '#8b5cf6' },
    { name: 'Продажи', value: totals.sales, fill: '#22c55e' },
  ], [totals]);

  const sourceChart = useMemo(() => sources
    .filter((row) => Number(row.leads || 0) > 0)
    .sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0))
    .slice(0, 7)
    .map((row) => ({ name: row.source || row.platform || 'Без источника', leads: Number(row.leads || 0), sales: Number(row.sales || 0) })), [sources]);

  const financial = [
    { name: 'Расход', value: totals.spend },
    { name: 'Выручка', value: totals.revenue },
  ];

  if (loading) return <section className="panel"><h2>Загрузка</h2><p className="note">Формируем управленческий дашборд.</p></section>;
  if (error) return <section className="panel"><h2>Ошибка подключения</h2><p className="note">{error}</p></section>;

  return <div className="stack marketing-dashboard-summary">
    <div className="heading"><span>1.6 Dashboard Marketing</span><h1>Дашборд маркетинга</h1><p>Управленческая сводка по лидам, продажам, расходам и выручке.</p></div>

    <section className="marketing-kpis">
      <article><span>Все лиды</span><strong>{number(totals.leads)}</strong><small>За текущий период</small></article>
      <article><span>Целевые лиды</span><strong>{number(totals.target)}</strong><small>{percent(totals.target, totals.leads)} от всех</small></article>
      <article><span>Пришли</span><strong>{number(totals.arrived)}</strong><small>{percent(totals.arrived, totals.target)} от целевых</small></article>
      <article><span>Продажи</span><strong>{number(totals.sales)}</strong><small>{percent(totals.sales, totals.arrived)} от пришедших</small></article>
      <article><span>Выручка</span><strong>{money(totals.revenue)}</strong><small>Средний чек {money(totals.sales ? totals.revenue / totals.sales : 0)}</small></article>
      <article><span>Рекламный расход</span><strong>{money(totals.spend)}</strong><small>ROMI {totals.spend ? Math.round((totals.revenue - totals.spend) * 100 / totals.spend) : 0}%</small></article>
    </section>

    <section className="dashboard-chart-grid dashboard-chart-grid--hero">
      <article className="panel dashboard-chart-card dashboard-chart-card--wide">
        <header><div><h2>Динамика воронки</h2><p>Лиды, целевые обращения, приходы и продажи по дням</p></div></header>
        <div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 12, right: 16, left: -12, bottom: 0 }}><defs><linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.45}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="date" stroke="#64748b" tickLine={false}/><YAxis stroke="#64748b" tickLine={false}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }}/><Legend/><Area type="monotone" dataKey="leads" name="Все лиды" stroke="#2563eb" fill="url(#leadsGradient)" strokeWidth={3}/><Area type="monotone" dataKey="target" name="Целевые" stroke="#06b6d4" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="arrived" name="Пришли" stroke="#8b5cf6" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="sales" name="Продажи" stroke="#22c55e" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>
      </article>

      <article className="panel dashboard-chart-card">
        <header><div><h2>Воронка продаж</h2><p>Потери между этапами</p></div></header>
        <div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><FunnelChart><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value) => number(Number(value))}/><Funnel dataKey="value" data={funnel} isAnimationActive><LabelList position="right" fill="#e5edf8" stroke="none" dataKey="name"/><LabelList position="center" fill="#fff" stroke="none" dataKey="value" formatter={(value) => number(Number(value))}/></Funnel></FunnelChart></ResponsiveContainer></div>
      </article>
    </section>

    <section className="dashboard-chart-grid">
      <article className="panel dashboard-chart-card">
        <header><div><h2>Распределение лидов</h2><p>Доля ведущих источников</p></div></header>
        <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sourceChart} dataKey="leads" nameKey="name" innerRadius={66} outerRadius={104} paddingAngle={3}>{sourceChart.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[index % palette.length]}/>)}</Pie><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value) => number(Number(value))}/><Legend verticalAlign="bottom" height={54}/></PieChart></ResponsiveContainer></div>
      </article>

      <article className="panel dashboard-chart-card">
        <header><div><h2>Источники: лиды и продажи</h2><p>Сравнение эффективности каналов</p></div></header>
        <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={sourceChart} margin={{ top: 10, right: 10, left: -12, bottom: 20 }}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="name" stroke="#64748b" tickLine={false} angle={-18} textAnchor="end" height={58}/><YAxis stroke="#64748b" tickLine={false}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }}/><Legend/><Bar dataKey="leads" name="Лиды" fill="#2563eb" radius={[5, 5, 0, 0]}/><Bar dataKey="sales" name="Продажи" fill="#22c55e" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer></div>
      </article>

      <article className="panel dashboard-chart-card">
        <header><div><h2>Финансовый результат</h2><p>Расход против выручки</p></div></header>
        <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={financial} layout="vertical" margin={{ top: 18, right: 40, left: 15, bottom: 18 }}><CartesianGrid stroke="#1e2d4a" horizontal={false}/><XAxis type="number" stroke="#64748b" tickFormatter={(value) => number(Number(value))}/><YAxis type="category" dataKey="name" stroke="#94a3b8" width={70}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value) => money(Number(value))}/><Bar dataKey="value" radius={[0, 7, 7, 0]}>{financial.map((entry, index) => <Cell key={entry.name} fill={index === 0 ? '#f59e0b' : '#22c55e'}/>)}</Bar></BarChart></ResponsiveContainer></div>
        <div className="dashboard-finance-strip"><span>Средний чек <b>{money(totals.sales ? totals.revenue / totals.sales : 0)}</b></span><span>ROAS <b>{totals.spend ? (totals.revenue / totals.spend).toFixed(2) : '0.00'}x</b></span></div>
      </article>
    </section>

    <section className="panel"><h2>Источники</h2><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Расход</th><th>Выручка</th></tr></thead><tbody>{sources.map((row) => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{number(row.arrived)}</td><td>{number(row.sales)}</td><td>{money(row.spend)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
