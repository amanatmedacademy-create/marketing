import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronRight, Download, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';

type Campaign = {
  campaignId: string;
  campaignName: string;
  status: string;
  currency: string;
  totals: { spend: number; impressions: number; clicks: number; linkClicks: number; videoViews: number; leads: number; qualifiedLeads: number; arrived: number; sales: number; revenue: number };
  metrics: { ctr: number | null; cpc: number | null; cpm: number | null; cpl: number | null; cac: number | null; roas: number | null; vtr: number | null };
  adGroups: Array<{ id: string; name: string }>;
};

type Payload = {
  range: { since: string; until: string };
  currency: string;
  totals: Campaign['totals'];
  metrics: Campaign['metrics'];
  campaigns: Campaign[];
  trend: Array<{ date: string; spend: number; leads: number; clicks: number; impressions: number }>;
};

const dayRange = (days: number) => {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - days + 1);
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
};

const num = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
const money = (value: number | null, currency = 'KZT') => value == null ? '—' : new Intl.NumberFormat('ru-KZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const pct = (value: number | null) => value == null ? '—' : `${num.format(value)}%`;
const x = (value: number | null) => value == null ? '—' : `${num.format(value)}×`;

export function TikTokAdsCampaigns() {
  const [days, setDays] = useState(30);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sortKey, setSortKey] = useState<'spend' | 'impressions' | 'clicks' | 'leads' | 'sales' | 'roas'>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    const range = dayRange(days);
    setLoading(true);
    setError('');
    try {
      const payload = await apiFetch<Payload>(`/marketing/analytics/tiktok/campaigns?since=${range.since}&until=${range.until}`);
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить TikTok Ads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [days]);

  const rows = useMemo(() => {
    const list = [...(data?.campaigns ?? [])].filter((item) => item.campaignName.toLowerCase().includes(query.toLowerCase().trim()));
    const filtered = status === 'all' ? list : list.filter((item) => item.status === status);
    return filtered.sort((a, b) => {
      const av = sortKey === 'roas' ? (a.metrics.roas ?? 0) : a.totals[sortKey];
      const bv = sortKey === 'roas' ? (b.metrics.roas ?? 0) : b.totals[sortKey];
      return (Number(av) - Number(bv)) * (sortDir === 'asc' ? 1 : -1);
    });
  }, [data, query, status, sortKey, sortDir]);

  const sort = (key: typeof sortKey) => {
    if (key === sortKey) setSortDir((value) => value === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const exportCsv = () => {
    const header = ['Кампания','Статус','Расход','Показы','Клики','CTR','CPC','Лиды','CPL','Продажи','CAC','Выручка','ROAS'];
    const lines = rows.map((item) => [item.campaignName,item.status,item.totals.spend,item.totals.impressions,item.totals.linkClicks,item.metrics.ctr ?? '',item.metrics.cpc ?? '',item.totals.leads,item.metrics.cpl ?? '',item.totals.sales,item.metrics.cac ?? '',item.totals.revenue,item.metrics.roas ?? ''].join(';'));
    const blob = new Blob([`\uFEFF${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tiktok_campaigns_${data?.range.since ?? ''}_${data?.range.until ?? ''}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const maxSpend = Math.max(...(data?.trend ?? []).map((item) => item.spend), 1);
  const totals = data?.totals;
  const metrics = data?.metrics;

  return <div style={{ display: 'grid', gap: 16 }}>
    <section className="ads-card" style={{ display: 'grid', gap: 16 }}>
      <div className="ads-panel-head">
        <div><h2>TikTok Ads — кампании</h2><p>{data ? `${data.range.since} → ${data.range.until}` : 'Живые данные из canonical marketing facts'}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select>
          <button onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Обновить</button>
          <button onClick={exportCsv} disabled={!rows.length}><Download size={14} /> CSV</button>
        </div>
      </div>

      {error && <div className="ads-empty"><strong>Ошибка TikTok Ads</strong><br />{error}</div>}
      {!error && !loading && !rows.length && <div className="ads-empty">Данных TikTok пока нет. После подключения и синхронизации они появятся здесь.</div>}

      <div className="ads-metrics">
        <article><span>Расход</span><strong>{loading ? '—' : money(totals?.spend ?? 0, data?.currency)}</strong></article>
        <article><span>Показы</span><strong>{loading ? '—' : num.format(totals?.impressions ?? 0)}</strong></article>
        <article><span>CTR</span><strong>{loading ? '—' : pct(metrics?.ctr ?? null)}</strong></article>
        <article><span>CPC</span><strong>{loading ? '—' : money(metrics?.cpc ?? null, data?.currency)}</strong></article>
        <article><span>Лиды</span><strong>{loading ? '—' : num.format(totals?.leads ?? 0)}</strong><small>CPL {money(metrics?.cpl ?? null, data?.currency)}</small></article>
        <article><span>ROAS</span><strong>{loading ? '—' : x(metrics?.roas ?? null)}</strong><small>{num.format(totals?.sales ?? 0)} продаж</small></article>
      </div>

      {!!data?.trend.length && <div style={{ display: 'flex', alignItems: 'end', gap: 4, minHeight: 140, padding: '12px 4px 0' }}>
        {data.trend.map((item) => <div key={item.date} title={`${item.date}: ${money(item.spend, data.currency)} · ${item.leads} лидов`} style={{ flex: 1, minWidth: 4, display: 'grid', alignItems: 'end', height: 130 }}>
          <div style={{ height: `${Math.max(3, item.spend / maxSpend * 100)}%`, borderRadius: '5px 5px 0 0', background: 'linear-gradient(180deg,#25F4EE,#2563eb)' }} />
        </div>)}
      </div>}
    </section>

    <section className="ads-card">
      <div className="ads-card-toolbar" style={{ justifyContent: 'space-between' }}>
        <strong>Кампании ({rows.length})</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск кампании" /></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Все статусы</option><option value="ACTIVE">Активные</option><option value="LEARNING">Обучение</option><option value="PAUSED">Пауза</option><option value="UNKNOWN">Не определён</option></select>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="ads-performance-table"><thead><tr>
          <th>Кампания</th>{([['spend','Расход'],['impressions','Показы'],['clicks','Клики'],['leads','Лиды'],['sales','Продажи'],['roas','ROAS']] as const).map(([key,label]) => <th key={key}><button onClick={() => sort(key)}>{label}<ArrowUpDown size={11} /></button></th>)}
        </tr></thead><tbody>
          {rows.map((item) => <>
            <tr key={item.campaignId}><td><button onClick={() => toggle(item.campaignId)}>{expanded.has(item.campaignId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><strong>{item.campaignName}</strong><small style={{ marginLeft: 8 }}>{item.status}</small></td><td>{money(item.totals.spend,item.currency)}</td><td>{num.format(item.totals.impressions)}</td><td>{num.format(item.totals.linkClicks)}</td><td>{num.format(item.totals.leads)}<small>CPL {money(item.metrics.cpl,item.currency)}</small></td><td>{num.format(item.totals.sales)}<small>CAC {money(item.metrics.cac,item.currency)}</small></td><td>{x(item.metrics.roas)}</td></tr>
            {expanded.has(item.campaignId) && item.adGroups.map((group) => <tr key={`${item.campaignId}-${group.id}`}><td colSpan={7} style={{ paddingLeft: 48 }}>↳ {group.name}</td></tr>)}
          </>)}
        </tbody></table>
      </div>
    </section>
  </div>;
}
