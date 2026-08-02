import { useMemo, useState } from 'react';
import { BarChart3, Download, Filter, Search, SlidersHorizontal } from 'lucide-react';
import { useDealsQuery, usePipelinesQuery } from '../deals/api/useDeals';

type Row = {
  source: string;
  leads: number;
  qualified: number;
  appointments: number;
  visits: number;
  sales: number;
  revenue: number;
};

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });

export function EndToEndAnalytics() {
  const [query, setQuery] = useState('');
  const pipelinesQuery = usePipelinesQuery();
  const pipeline = pipelinesQuery.data?.find(item => item.isDefault) ?? pipelinesQuery.data?.[0];
  const dealsQuery = useDealsQuery(pipeline?.id);
  const deals = dealsQuery.data?.items ?? [];

  const rows = useMemo<Row[]>(() => {
    const stages = pipeline?.stages ?? [];
    const wonIds = new Set(stages.filter(stage => stage.isWon).map(stage => stage.id));
    const appointmentIds = new Set(stages.filter(stage => /консультац|запис|назнач/i.test(stage.name)).map(stage => stage.id));
    const visitIds = new Set(stages.filter(stage => /пришел|пришёл|визит|посет/i.test(stage.name)).map(stage => stage.id));
    const qualifiedIds = new Set(stages.filter(stage => !stage.isLost && !/нов/i.test(stage.name)).map(stage => stage.id));
    const grouped = new Map<string, Row>();
    for (const deal of deals) {
      const source = deal.source?.trim() || 'Без источника';
      const row = grouped.get(source) ?? { source, leads: 0, qualified: 0, appointments: 0, visits: 0, sales: 0, revenue: 0 };
      row.leads += 1;
      if (qualifiedIds.has(deal.stageId)) row.qualified += 1;
      if (appointmentIds.has(deal.stageId)) row.appointments += 1;
      if (visitIds.has(deal.stageId)) row.visits += 1;
      if (wonIds.has(deal.stageId)) {
        row.sales += 1;
        row.revenue += Number(deal.oneTimeAmount ?? 0);
      }
      grouped.set(source, row);
    }
    return [...grouped.values()].sort((a, b) => b.leads - a.leads);
  }, [deals, pipeline]);

  const filtered = rows.filter(row => row.source.toLowerCase().includes(query.trim().toLowerCase()));
  const totals = rows.reduce((acc, row) => ({
    leads: acc.leads + row.leads,
    qualified: acc.qualified + row.qualified,
    appointments: acc.appointments + row.appointments,
    visits: acc.visits + row.visits,
    sales: acc.sales + row.sales,
    revenue: acc.revenue + row.revenue,
  }), { leads: 0, qualified: 0, appointments: 0, visits: 0, sales: 0, revenue: 0 });

  return <div className="e2e-workspace">
    <header className="e2e-heading"><span><BarChart3 size={21} /></span><div><h1>Сквозная аналитика</h1><p>Полная цепочка от рекламного расхода до продажи и выручки.</p></div></header>

    <section className="e2e-kpis">
      <article><span>Расход</span><strong>—</strong><small>После подключения Ads API</small></article>
      <article><span>Лиды CRM</span><strong>{dealsQuery.isLoading ? '—' : totals.leads}</strong><small>Все источники</small></article>
      <article><span>Записи</span><strong>{dealsQuery.isLoading ? '—' : totals.appointments}</strong><small>По этапам CRM</small></article>
      <article><span>Продажи</span><strong>{dealsQuery.isLoading ? '—' : totals.sales}</strong><small>{totals.leads ? Math.round(totals.sales / totals.leads * 100) : 0}% конверсия</small></article>
      <article><span>Выручка</span><strong>{dealsQuery.isLoading ? '—' : money.format(totals.revenue)}</strong><small>Закрытые сделки</small></article>
      <article><span>ROMI</span><strong>—</strong><small>Нужны расходы</small></article>
    </section>

    <section className="e2e-card">
      <header className="e2e-table-head"><div><h2>Источники и воронка</h2><p>Реклама → лид → квалификация → запись → визит → продажа → выручка.</p></div><div><button><Download size={14} /> Экспорт</button><button><SlidersHorizontal size={14} /> Столбцы</button></div></header>
      <div className="e2e-toolbar"><label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Источник, кампания или кабинет" /></label><button><Filter size={14} /> Фильтры</button></div>
      <div className="e2e-table-scroll"><table><thead><tr><th>Источник</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды CRM</th><th>Квалифицировано</th><th>Записи</th><th>Визиты</th><th>Продажи</th><th>Конверсия</th><th>Выручка</th><th>CPL</th><th>CAC</th><th>ROAS</th><th>ROMI</th></tr></thead><tbody>{filtered.map(row => <tr key={row.source}><td><strong>{row.source}</strong></td><td>—</td><td>—</td><td>—</td><td>{row.leads}</td><td>{row.qualified}</td><td>{row.appointments}</td><td>{row.visits}</td><td>{row.sales}</td><td>{row.leads ? Math.round(row.sales / row.leads * 100) : 0}%</td><td>{money.format(row.revenue)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>)}{!filtered.length && <tr><td colSpan={15}><div className="e2e-empty">Нет данных по выбранным условиям.</div></td></tr>}</tbody><tfoot><tr><td><strong>Итого</strong></td><td>—</td><td>—</td><td>—</td><td>{totals.leads}</td><td>{totals.qualified}</td><td>{totals.appointments}</td><td>{totals.visits}</td><td>{totals.sales}</td><td>{totals.leads ? Math.round(totals.sales / totals.leads * 100) : 0}%</td><td>{money.format(totals.revenue)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr></tfoot></table></div>
      <footer className="e2e-note">CRM-метрики считаются по фактическим сделкам. Рекламные показатели и экономика появятся после подключения кабинетов.</footer>
    </section>
  </div>;
}
