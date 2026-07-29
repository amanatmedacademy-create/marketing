import { useEffect, useMemo, useState } from 'react';
import { marketingApi, type DashboardDailyRow, type SourceSummaryRow } from '../services/api';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${(value * 100 / total).toFixed(1)}%` : '0%';

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

  if (loading) return <section className="panel"><h2>Загрузка</h2><p className="note">Формируем управленческий дашборд.</p></section>;
  if (error) return <section className="panel"><h2>Ошибка подключения</h2><p className="note">{error}</p></section>;

  return <div className="stack">
    <div className="heading"><span>1.6 Dashboard Marketing</span><h1>Дашборд маркетинга</h1><p>Краткая управленческая сводка по лидам, продажам, расходам и выручке.</p></div>

    <section className="marketing-kpis">
      <article><span>Все лиды</span><strong>{number(totals.leads)}</strong><small>За текущий период</small></article>
      <article><span>Целевые лиды</span><strong>{number(totals.target)}</strong><small>{percent(totals.target, totals.leads)} от всех</small></article>
      <article><span>Пришли</span><strong>{number(totals.arrived)}</strong><small>{percent(totals.arrived, totals.target)} от целевых</small></article>
      <article><span>Продажи</span><strong>{number(totals.sales)}</strong><small>{percent(totals.sales, totals.arrived)} от пришедших</small></article>
      <article><span>Выручка</span><strong>{money(totals.revenue)}</strong><small>Средний чек {money(totals.sales ? totals.revenue / totals.sales : 0)}</small></article>
      <article><span>Рекламный расход</span><strong>{money(totals.spend)}</strong><small>ROMI {totals.spend ? Math.round((totals.revenue - totals.spend) * 100 / totals.spend) : 0}%</small></article>
    </section>

    <section className="dashboard-summary-grid">
      <article className="panel"><h2>Воронка</h2><div className="dashboard-funnel-list"><span>Все лиды <b>{number(totals.leads)}</b></span><span>Целевые <b>{number(totals.target)}</b></span><span>Пришли <b>{number(totals.arrived)}</b></span><span>Продажи <b>{number(totals.sales)}</b></span></div></article>
      <article className="panel"><h2>Финансовый результат</h2><div className="dashboard-funnel-list"><span>Расход <b>{money(totals.spend)}</b></span><span>Выручка <b>{money(totals.revenue)}</b></span><span>Средний чек <b>{money(totals.sales ? totals.revenue / totals.sales : 0)}</b></span><span>ROAS <b>{totals.spend ? (totals.revenue / totals.spend).toFixed(2) : '0.00'}x</b></span></div></article>
    </section>

    <section className="panel"><h2>Источники</h2><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Расход</th><th>Выручка</th></tr></thead><tbody>{sources.map((row) => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{number(row.arrived)}</td><td>{number(row.sales)}</td><td>{money(row.spend)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
