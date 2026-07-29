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
  type DashboardDailyRow,
  type MarketingLead,
  type SourceSummaryRow,
} from '../services/api';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${(value * 100 / total).toFixed(1)}%` : '0%';
const palette = ['#2563eb', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444'];
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const hasAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

export default function MarketingDashboardSummary() {
  const [daily, setDaily] = useState<DashboardDailyRow[]>([]);
  const [sources, setSources] = useState<SourceSummaryRow[]>([]);
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      marketingApi.dashboard(),
      marketingApi.sources(),
      marketingApi.listLeads({ limit: 5000 }),
    ])
      .then(([dailyRows, sourceRows, leadRows]) => {
        if (!active) return;
        setDaily(dailyRows);
        setSources(sourceRows);
        setLeads(leadRows);
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

  const leadStats = useMemo(() => {
    const result = {
      appointments: 0,
      nonTarget: 0,
      noContact: 0,
      refused: 0,
      cancelled: 0,
      noShow: 0,
      open: 0,
    };

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
  const cpl = totals.leads ? totals.spend / totals.leads : 0;
  const targetCpl = totals.target ? totals.spend / totals.target : 0;
  const appointmentCost = appointments ? totals.spend / appointments : 0;
  const arrivalCost = totals.arrived ? totals.spend / totals.arrived : 0;
  const cac = totals.sales ? totals.spend / totals.sales : 0;
  const averageCheck = totals.sales ? totals.revenue / totals.sales : 0;
  const roas = totals.spend ? totals.revenue / totals.spend : 0;
  const romi = totals.spend ? ((totals.revenue - totals.spend) / totals.spend) * 100 : 0;

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
    { name: 'Записаны', value: appointments, fill: '#f59e0b' },
    { name: 'Пришли', value: totals.arrived, fill: '#8b5cf6' },
    { name: 'Продажи', value: totals.sales, fill: '#22c55e' },
  ], [totals, appointments]);

  const sourceChart = useMemo(() => sources
    .filter((row) => Number(row.leads || 0) > 0)
    .sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0))
    .slice(0, 8)
    .map((row) => ({
      name: row.source || row.platform || 'Без источника',
      leads: Number(row.leads || 0),
      target: Number(row.target_leads || 0),
      arrived: Number(row.arrived || 0),
      sales: Number(row.sales || 0),
    })), [sources]);

  const losses = [
    { name: 'Нецелевые', value: leadStats.nonTarget },
    { name: 'Не дозвонились', value: leadStats.noContact },
    { name: 'Отказались', value: leadStats.refused },
    { name: 'Отменили', value: leadStats.cancelled },
    { name: 'Не пришли', value: leadStats.noShow },
    { name: 'В работе', value: leadStats.open },
  ].filter((item) => item.value > 0);

  const financial = [
    { name: 'Расход', value: totals.spend },
    { name: 'Выручка', value: totals.revenue },
  ];

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
      <article><span>Конверсия лид → продажа</span><strong>{percent(totals.sales, totals.leads)}</strong><small>{number(totals.sales)} продаж из {number(totals.leads)} лидов</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Нецелевые</span><strong>{number(leadStats.nonTarget)}</strong><small>{percent(leadStats.nonTarget, totals.leads)}</small></article>
      <article><span>Не дозвонились</span><strong>{number(leadStats.noContact)}</strong><small>{percent(leadStats.noContact, totals.leads)}</small></article>
      <article><span>Отказались</span><strong>{number(leadStats.refused)}</strong><small>{percent(leadStats.refused, totals.leads)}</small></article>
      <article><span>Отменили запись</span><strong>{number(leadStats.cancelled)}</strong><small>{percent(leadStats.cancelled, appointments)}</small></article>
      <article><span>Не пришли</span><strong>{number(leadStats.noShow)}</strong><small>{percent(leadStats.noShow, appointments)}</small></article>
      <article><span>Остаются в работе</span><strong>{number(leadStats.open)}</strong><small>Без продажи и закрывающего статуса</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Лид → целевой</span><strong>{percent(totals.target, totals.leads)}</strong><small>{number(totals.target)} из {number(totals.leads)}</small></article>
      <article><span>Целевой → запись</span><strong>{percent(appointments, totals.target)}</strong><small>{number(appointments)} из {number(totals.target)}</small></article>
      <article><span>Запись → приход</span><strong>{percent(totals.arrived, appointments)}</strong><small>{number(totals.arrived)} из {number(appointments)}</small></article>
      <article><span>Приход → продажа</span><strong>{percent(totals.sales, totals.arrived)}</strong><small>{number(totals.sales)} из {number(totals.arrived)}</small></article>
      <article><span>Целевой → продажа</span><strong>{percent(totals.sales, totals.target)}</strong><small>Итоговая конверсия качества</small></article>
      <article><span>Запись → продажа</span><strong>{percent(totals.sales, appointments)}</strong><small>Эффективность записей</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Рекламный расход</span><strong>{money(totals.spend)}</strong><small>За выбранный период</small></article>
      <article><span>CPL</span><strong>{money(cpl)}</strong><small>Стоимость одного лида</small></article>
      <article><span>Стоимость целевого</span><strong>{money(targetCpl)}</strong><small>Расход / целевые лиды</small></article>
      <article><span>Стоимость записи</span><strong>{money(appointmentCost)}</strong><small>Расход / записи</small></article>
      <article><span>Стоимость прихода</span><strong>{money(arrivalCost)}</strong><small>Расход / пришедшие</small></article>
      <article><span>CAC</span><strong>{money(cac)}</strong><small>Стоимость одной продажи</small></article>
    </section>

    <section className="marketing-kpis">
      <article><span>Выручка</span><strong>{money(totals.revenue)}</strong><small>По продажам CRM</small></article>
      <article><span>Средний чек</span><strong>{money(averageCheck)}</strong><small>Выручка / продажи</small></article>
      <article><span>ROAS</span><strong>{roas.toFixed(2)}x</strong><small>Выручка / рекламный расход</small></article>
      <article><span>ROMI</span><strong>{romi.toFixed(1)}%</strong><small>До учёта операционных расходов</small></article>
      <article><span>Доход на лид</span><strong>{money(totals.leads ? totals.revenue / totals.leads : 0)}</strong><small>Выручка / все лиды</small></article>
      <article><span>Доход на приход</span><strong>{money(totals.arrived ? totals.revenue / totals.arrived : 0)}</strong><small>Выручка / пришедшие</small></article>
    </section>

    <section className="dashboard-chart-grid dashboard-chart-grid--hero">
      <article className="panel dashboard-chart-card dashboard-chart-card--wide">
        <header><div><h2>Динамика воронки</h2><p>Лиды, целевые обращения, приходы и продажи по дням</p></div></header>
        <div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 12, right: 16, left: -12, bottom: 0 }}><defs><linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.45}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="date" stroke="#64748b" tickLine={false}/><YAxis stroke="#64748b" tickLine={false}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }}/><Legend/><Area type="monotone" dataKey="leads" name="Все лиды" stroke="#2563eb" fill="url(#leadsGradient)" strokeWidth={3}/><Area type="monotone" dataKey="target" name="Целевые" stroke="#06b6d4" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="arrived" name="Пришли" stroke="#8b5cf6" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="sales" name="Продажи" stroke="#22c55e" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>
      </article>

      <article className="panel dashboard-chart-card">
        <header><div><h2>Полная воронка</h2><p>От общего лида до продажи</p></div></header>
        <div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><FunnelChart><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown) => number(Number(value))}/><Funnel dataKey="value" data={funnel} isAnimationActive><LabelList position="right" fill="#e5edf8" stroke="none" dataKey="name"/><LabelList position="center" fill="#fff" stroke="none" dataKey="value" formatter={(value: unknown) => number(Number(value))}/></Funnel></FunnelChart></ResponsiveContainer></div>
      </article>
    </section>

    <section className="dashboard-chart-grid">
      <article className="panel dashboard-chart-card">
        <header><div><h2>Распределение лидов</h2><p>Доля ведущих источников</p></div></header>
        <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sourceChart} dataKey="leads" nameKey="name" innerRadius={66} outerRadius={104} paddingAngle={3}>{sourceChart.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[index % palette.length]}/>)}</Pie><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown) => number(Number(value))}/><Legend verticalAlign="bottom" height={54}/></PieChart></ResponsiveContainer></div>
      </article>

      <article className="panel dashboard-chart-card">
        <header><div><h2>Потери и незакрытые лиды</h2><p>Причины выпадения из воронки</p></div></header>
        <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={losses} dataKey="value" nameKey="name" innerRadius={58} outerRadius={103} paddingAngle={3}>{losses.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[(index + 2) % palette.length]}/>)}</Pie><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown) => number(Number(value))}/><Legend verticalAlign="bottom" height={54}/></PieChart></ResponsiveContainer></div>
      </article>

      <article className="panel dashboard-chart-card">
        <header><div><h2>Финансовый результат</h2><p>Расход против выручки</p></div></header>
        <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={financial} layout="vertical" margin={{ top: 18, right: 40, left: 15, bottom: 18 }}><CartesianGrid stroke="#1e2d4a" horizontal={false}/><XAxis type="number" stroke="#64748b" tickFormatter={(value: unknown) => number(Number(value))}/><YAxis type="category" dataKey="name" stroke="#94a3b8" width={70}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }} formatter={(value: unknown) => money(Number(value))}/><Bar dataKey="value" radius={[0, 7, 7, 0]}>{financial.map((entry, index) => <Cell key={entry.name} fill={index === 0 ? '#f59e0b' : '#22c55e'}/>)}</Bar></BarChart></ResponsiveContainer></div>
        <div className="dashboard-finance-strip"><span>Средний чек <b>{money(averageCheck)}</b></span><span>ROAS <b>{roas.toFixed(2)}x</b></span></div>
      </article>
    </section>

    <section className="panel dashboard-chart-card">
      <header><div><h2>Источники: полный путь лида</h2><p>Лиды, целевые, приходы и продажи по каналам</p></div></header>
      <div className="dashboard-chart dashboard-chart--large"><ResponsiveContainer width="100%" height="100%"><BarChart data={sourceChart} margin={{ top: 10, right: 10, left: -12, bottom: 45 }}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="name" stroke="#64748b" tickLine={false} angle={-18} textAnchor="end" height={72}/><YAxis stroke="#64748b" tickLine={false}/><Tooltip contentStyle={{ background: '#07101d', border: '1px solid #253858', borderRadius: 10 }}/><Legend/><Bar dataKey="leads" name="Лиды" fill="#2563eb" radius={[4, 4, 0, 0]}/><Bar dataKey="target" name="Целевые" fill="#06b6d4" radius={[4, 4, 0, 0]}/><Bar dataKey="arrived" name="Пришли" fill="#8b5cf6" radius={[4, 4, 0, 0]}/><Bar dataKey="sales" name="Продажи" fill="#22c55e" radius={[4, 4, 0, 0]}/></BarChart></ResponsiveContainer></div>
    </section>

    <section className="panel"><h2>Источники и конверсии</h2><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Конв. в целевой</th><th>Пришли</th><th>Конв. в приход</th><th>Продажи</th><th>Лид → продажа</th><th>Расход</th><th>CPL</th><th>CAC</th><th>Выручка</th><th>ROAS</th></tr></thead><tbody>{sources.map((row) => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{percent(row.target_leads, row.leads)}</td><td>{number(row.arrived)}</td><td>{percent(row.arrived, row.target_leads)}</td><td>{number(row.sales)}</td><td>{percent(row.sales, row.leads)}</td><td>{money(row.spend)}</td><td>{money(row.leads ? row.spend / row.leads : 0)}</td><td>{money(row.sales ? row.spend / row.sales : 0)}</td><td>{money(row.revenue)}</td><td>{row.spend ? (row.revenue / row.spend).toFixed(2) : '0.00'}x</td></tr>)}</tbody></table></div></section>
  </div>;
}
