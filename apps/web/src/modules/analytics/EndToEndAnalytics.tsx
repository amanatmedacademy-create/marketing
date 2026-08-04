import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Filter, Search, SlidersHorizontal } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';
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

type AnalyticsTotals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  qualifiedLeads: number;
  sales: number;
  revenue: number;
};

type AnalyticsMetrics = {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  cpql: number | null;
  cac: number | null;
  roas: number | null;
  roi: number | null;
};

type ProviderOverview = {
  provider: string;
  totals: AnalyticsTotals;
  metrics: AnalyticsMetrics;
};

type AnalyticsOverview = {
  range: { since: string; until: string };
  currency: string;
  source: 'canonical' | 'legacy_meta';
  totals: AnalyticsTotals;
  metrics: AnalyticsMetrics;
  byProvider: ProviderOverview[];
  rows: number;
};

const money = (value: number, currency = 'KZT') => new Intl.NumberFormat('ru-KZ', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(value);
const number = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });

function dateRange(days: number) {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - (days - 1));
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

export function EndToEndAnalytics() {
  const [query, setQuery] = useState('');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');
  const pipelinesQuery = usePipelinesQuery();
  const pipeline = pipelinesQuery.data?.find(item => item.isDefault) ?? pipelinesQuery.data?.[0];
  const dealsQuery = useDealsQuery(pipeline?.id);
  const deals = dealsQuery.data?.items ?? [];

  useEffect(() => {
    const range = dateRange(days);
    let active = true;
    setAnalyticsLoading(true);
    void apiFetch<AnalyticsOverview>(`/marketing/analytics/overview?since=${range.since}&until=${range.until}`)
      .then((payload) => {
        if (!active) return;
        setOverview(payload);
        setAnalyticsError('');
      })
      .catch((error) => {
        if (!active) return;
        setOverview(null);
        setAnalyticsError(error instanceof Error ? error.message : 'Не удалось загрузить маркетинговую аналитику');
      })
      .finally(() => {
        if (active) setAnalyticsLoading(false);
      });
    return () => { active = false; };
  }, [days]);

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
  const crmTotals = rows.reduce((acc, row) => ({
    leads: acc.leads + row.leads,
    qualified: acc.qualified + row.qualified,
    appointments: acc.appointments + row.appointments,
    visits: acc.visits + row.visits,
    sales: acc.sales + row.sales,
    revenue: acc.revenue + row.revenue,
  }), { leads: 0, qualified: 0, appointments: 0, visits: 0, sales: 0, revenue: 0 });

  const adTotals = overview?.totals;
  const adMetrics = overview?.metrics;
  const currency = overview?.currency || 'KZT';
  const combinedRevenue = crmTotals.revenue || adTotals?.revenue || 0;
  const combinedSales = crmTotals.sales || adTotals?.sales || 0;
  const combinedLeads = crmTotals.leads || adTotals?.leads || 0;
  const cac = combinedSales && adTotals?.spend ? adTotals.spend / combinedSales : null;
  const roas = adTotals?.spend && combinedRevenue ? combinedRevenue / adTotals.spend : adMetrics?.roas ?? null;
  const roi = adTotals?.spend && combinedRevenue ? (combinedRevenue - adTotals.spend) / adTotals.spend * 100 : adMetrics?.roi ?? null;

  return <div className="e2e-workspace">
    <header className="e2e-heading">
      <span><BarChart3 size={21} /></span>
      <div><h1>Маркетинговая аналитика</h1><p>Реклама, лиды, продажи и выручка в единой модели данных.</p></div>
      <select value={days} onChange={event => setDays(Number(event.target.value))} aria-label="Период аналитики">
        <option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option>
      </select>
    </header>

    <section className="e2e-kpis">
      <article><span>Расход</span><strong>{analyticsLoading ? '—' : money(adTotals?.spend ?? 0, currency)}</strong><small>{days} дней</small></article>
      <article><span>Показы</span><strong>{analyticsLoading ? '—' : number.format(adTotals?.impressions ?? 0)}</strong><small>Охват {number.format(adTotals?.reach ?? 0)}</small></article>
      <article><span>Клики</span><strong>{analyticsLoading ? '—' : number.format(adTotals?.linkClicks ?? 0)}</strong><small>CTR {adMetrics?.ctr == null ? '—' : `${number.format(adMetrics.ctr)}%`}</small></article>
      <article><span>Лиды</span><strong>{dealsQuery.isLoading && analyticsLoading ? '—' : number.format(combinedLeads)}</strong><small>CPL {adMetrics?.cpl == null ? '—' : money(adMetrics.cpl, currency)}</small></article>
      <article><span>Продажи</span><strong>{dealsQuery.isLoading ? '—' : number.format(combinedSales)}</strong><small>CAC {cac == null ? '—' : money(cac, currency)}</small></article>
      <article><span>Выручка</span><strong>{dealsQuery.isLoading ? '—' : money(combinedRevenue, currency)}</strong><small>ROAS {roas == null ? '—' : number.format(roas)}</small></article>
    </section>

    {analyticsError && <div className="e2e-note">Рекламные показатели недоступны: {analyticsError}</div>}

    <section className="e2e-card">
      <header className="e2e-table-head"><div><h2>Источники и воронка</h2><p>Реклама → лид → квалификация → запись → визит → продажа → выручка.</p></div><div><button><Download size={14} /> Экспорт</button><button><SlidersHorizontal size={14} /> Столбцы</button></div></header>
      <div className="e2e-toolbar"><label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Источник, кампания или кабинет" /></label><button><Filter size={14} /> Фильтры</button></div>
      <div className="e2e-table-scroll"><table><thead><tr><th>Источник</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды CRM</th><th>Квалифицировано</th><th>Записи</th><th>Визиты</th><th>Продажи</th><th>Конверсия</th><th>Выручка</th><th>CPL</th><th>CAC</th><th>ROAS</th><th>ROI</th></tr></thead><tbody>{filtered.map(row => <tr key={row.source}><td><strong>{row.source}</strong></td><td>—</td><td>—</td><td>—</td><td>{row.leads}</td><td>{row.qualified}</td><td>{row.appointments}</td><td>{row.visits}</td><td>{row.sales}</td><td>{row.leads ? Math.round(row.sales / row.leads * 100) : 0}%</td><td>{money(row.revenue, currency)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>)}{!filtered.length && <tr><td colSpan={15}><div className="e2e-empty">Нет CRM-данных по выбранным условиям.</div></td></tr>}</tbody><tfoot><tr><td><strong>Итого</strong></td><td>{money(adTotals?.spend ?? 0, currency)}</td><td>{number.format(adTotals?.impressions ?? 0)}</td><td>{number.format(adTotals?.linkClicks ?? 0)}</td><td>{crmTotals.leads}</td><td>{crmTotals.qualified}</td><td>{crmTotals.appointments}</td><td>{crmTotals.visits}</td><td>{combinedSales}</td><td>{combinedLeads ? Math.round(combinedSales / combinedLeads * 100) : 0}%</td><td>{money(combinedRevenue, currency)}</td><td>{adMetrics?.cpl == null ? '—' : money(adMetrics.cpl, currency)}</td><td>{cac == null ? '—' : money(cac, currency)}</td><td>{roas == null ? '—' : number.format(roas)}</td><td>{roi == null ? '—' : `${number.format(roi)}%`}</td></tr></tfoot></table></div>
      <footer className="e2e-note">Источник рекламных данных: {overview?.source === 'canonical' ? 'единая модель Marketing Analytics' : 'совместимый Meta Ads pipeline'}. Строк за период: {overview?.rows ?? 0}.</footer>
    </section>
  </div>;
}
