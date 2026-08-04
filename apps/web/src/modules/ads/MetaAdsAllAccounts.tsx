import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpDown, ChevronDown, ChevronRight, Download, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';

type Totals = { spend: number; impressions: number; reach: number; clicks: number; linkClicks: number; leads: number; qualifiedLeads: number; arrived: number; sales: number; revenue: number };
type Metrics = { ctr: number | null; cpc: number | null; cpm: number | null; cpl: number | null; cac: number | null; roas: number | null };
type AdGroup = { id: string; name: string; totals: Totals; metrics: Metrics };
type Campaign = { campaignId: string; campaignName: string; accountId: string; accountName: string; status: string; currency: string; totals: Totals; metrics: Metrics; adGroups: AdGroup[] };
type Account = { accountId: string; accountName: string; currency: string; campaignCount: number; totals: Totals; metrics: Metrics };
type Payload = {
  range: { since: string; until: string };
  currency: string;
  source: 'canonical' | 'legacy_meta';
  totals: Totals;
  metrics: Metrics;
  previousTotals: Totals;
  previousMetrics: Metrics;
  accounts: Account[];
  campaigns: Campaign[];
  trend: Array<{ date: string; spend: number; leads: number }>;
  freshness: { lastMetricDate: string | null; lastSyncedAt: string | null };
};

const dayRange = (days: number) => {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - days + 1);
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
};
const number = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
const money = (value: number | null, currency = 'KZT') => value == null ? '—' : new Intl.NumberFormat('ru-KZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const pct = (value: number | null) => value == null ? '—' : `${number.format(value)}%`;
const delta = (current: number, previous: number) => previous ? (current - previous) / previous * 100 : null;

export function MetaAdsAllAccounts() {
  const [days, setDays] = useState(30);
  const [accountId, setAccountId] = useState('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sortKey, setSortKey] = useState<'spend' | 'impressions' | 'clicks' | 'leads'>('spend');
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
      const account = accountId === 'all' ? '' : `&accountId=${encodeURIComponent(accountId)}`;
      const payload = await apiFetch<Payload>(`/marketing/analytics/meta/campaigns?since=${range.since}&until=${range.until}${account}`);
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить Meta Ads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [days, accountId]);

  const rows = useMemo(() => {
    const filtered = (data?.campaigns ?? []).filter((item) => item.campaignName.toLowerCase().includes(query.trim().toLowerCase()));
    const statusRows = status === 'all' ? filtered : filtered.filter((item) => item.status === status);
    return [...statusRows].sort((a, b) => (a.totals[sortKey] - b.totals[sortKey]) * (sortDir === 'asc' ? 1 : -1));
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
    const header = ['Кабинет','Кампания','Статус','Расход','Показы','Клики','CTR','CPC','Лиды','CPL'];
    const lines = rows.map((item) => [item.accountName,item.campaignName,item.status,item.totals.spend,item.totals.impressions,item.totals.linkClicks || item.totals.clicks,item.metrics.ctr ?? '',item.metrics.cpc ?? '',item.totals.leads,item.metrics.cpl ?? ''].join(';'));
    const blob = new Blob([`\uFEFF${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `meta_campaigns_${data?.range.since ?? ''}_${data?.range.until ?? ''}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const maxSpend = Math.max(...(data?.trend ?? []).map((item) => item.spend), 1);
  const freshnessDays = data?.freshness.lastMetricDate ? Math.floor((Date.now() - new Date(`${data.freshness.lastMetricDate}T00:00:00Z`).getTime()) / 86400000) : 0;
  const totals = data?.totals;
  const previous = data?.previousTotals;
  const metrics = data?.metrics;

  return <div style={{ display: 'grid', gap: 16 }}>
    <section className="ads-card" style={{ display: 'grid', gap: 16 }}>
      <div className="ads-panel-head">
        <div><h2>Meta Ads — все рекламные кабинеты</h2><p>{data ? `${data.range.since} → ${data.range.until} · ${data.accounts.length} кабинетов · ${data.source === 'legacy_meta' ? 'текущий Meta pipeline' : 'canonical facts'}` : 'Живые данные через защищённый Worker API'}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select>
          <button onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Обновить</button>
          <button onClick={exportCsv} disabled={!rows.length}><Download size={14} /> CSV</button>
        </div>
      </div>

      {freshnessDays > 1 && <div className="ads-empty" style={{ textAlign: 'left' }}><AlertTriangle size={15} /> Последние данные: {data?.freshness.lastMetricDate} ({freshnessDays} дн. назад). Проверьте синхронизацию Meta.</div>}
      {error && <div className="ads-empty"><strong>Ошибка Meta Ads</strong><br />{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={accountId === 'all' ? 'primary' : ''} onClick={() => setAccountId('all')}>Все кабинеты</button>
        {(data?.accounts ?? []).map((account) => <button key={account.accountId} className={accountId === account.accountId ? 'primary' : ''} onClick={() => setAccountId(account.accountId)}>{account.accountName} · {money(account.totals.spend, account.currency)}</button>)}
      </div>

      <div className="ads-metrics">
        <article><span>Расход</span><strong>{loading ? '—' : money(totals?.spend ?? 0, data?.currency)}</strong><small>{delta(totals?.spend ?? 0, previous?.spend ?? 0) == null ? 'Нет сравнения' : `${number.format(delta(totals?.spend ?? 0, previous?.spend ?? 0)!)}% к прошлому периоду`}</small></article>
        <article><span>Показы</span><strong>{loading ? '—' : number.format(totals?.impressions ?? 0)}</strong></article>
        <article><span>Клики</span><strong>{loading ? '—' : number.format((totals?.linkClicks || totals?.clicks) ?? 0)}</strong><small>CTR {pct(metrics?.ctr ?? null)}</small></article>
        <article><span>CPC</span><strong>{loading ? '—' : money(metrics?.cpc ?? null, data?.currency)}</strong></article>
        <article><span>Лиды</span><strong>{loading ? '—' : number.format(totals?.leads ?? 0)}</strong><small>CPL {money(metrics?.cpl ?? null, data?.currency)}</small></article>
      </div>

      {!!data?.trend.length && <div style={{ display: 'flex', alignItems: 'end', gap: 4, minHeight: 140, padding: '12px 4px 0' }}>
        {data.trend.map((item) => <div key={item.date} title={`${item.date}: ${money(item.spend, data.currency)} · ${item.leads} лидов`} style={{ flex: 1, minWidth: 4, display: 'grid', alignItems: 'end', height: 130 }}><div style={{ height: `${Math.max(3, item.spend / maxSpend * 100)}%`, borderRadius: '5px 5px 0 0', background: 'linear-gradient(180deg,#1877F2,#E1306C)' }} /></div>)}
      </div>}
    </section>

    {accountId === 'all' && !!data?.accounts.length && <section className="ads-card">
      <div className="ads-panel-head"><div><h2>Кабинеты</h2><p>Сводка за выбранный период</p></div></div>
      <div style={{ overflowX: 'auto' }}><table className="ads-performance-table"><thead><tr><th>Кабинет</th><th>Кампании</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды</th><th>CPL</th></tr></thead><tbody>
        {data.accounts.map((account) => <tr key={account.accountId} onClick={() => setAccountId(account.accountId)}><td><strong>{account.accountName}</strong></td><td>{account.campaignCount}</td><td>{money(account.totals.spend, account.currency)}</td><td>{number.format(account.totals.impressions)}</td><td>{number.format(account.totals.linkClicks || account.totals.clicks)}</td><td>{number.format(account.totals.leads)}</td><td>{money(account.metrics.cpl, account.currency)}</td></tr>)}
      </tbody></table></div>
    </section>}

    <section className="ads-card">
      <div className="ads-card-toolbar" style={{ justifyContent: 'space-between' }}>
        <strong>Кампании ({rows.length})</strong>
        <div style={{ display: 'flex', gap: 8 }}><label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск кампании" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Все статусы</option><option value="ACTIVE">Активные</option><option value="PAUSED">Пауза</option><option value="UNKNOWN">Не определён</option></select></div>
      </div>
      <div style={{ overflowX: 'auto' }}><table className="ads-performance-table"><thead><tr><th>Кампания</th>{([['spend','Расход'],['impressions','Показы'],['clicks','Клики'],['leads','Лиды']] as const).map(([key,label]) => <th key={key}><button onClick={() => sort(key)}>{label}<ArrowUpDown size={11} /></button></th>)}<th>CTR</th><th>CPC</th><th>CPL</th></tr></thead><tbody>
        {rows.map((item) => <React.Fragment key={`${item.accountId}-${item.campaignId}`}><tr><td><button onClick={() => toggle(`${item.accountId}-${item.campaignId}`)}>{expanded.has(`${item.accountId}-${item.campaignId}`) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><strong>{item.campaignName}</strong><small style={{ marginLeft: 8 }}>{item.accountName} · {item.status}</small></td><td>{money(item.totals.spend,item.currency)}</td><td>{number.format(item.totals.impressions)}</td><td>{number.format(item.totals.linkClicks || item.totals.clicks)}</td><td>{number.format(item.totals.leads)}</td><td>{pct(item.metrics.ctr)}</td><td>{money(item.metrics.cpc,item.currency)}</td><td>{money(item.metrics.cpl,item.currency)}</td></tr>
          {expanded.has(`${item.accountId}-${item.campaignId}`) && item.adGroups.map((group) => <tr key={`${item.accountId}-${item.campaignId}-${group.id}`}><td style={{ paddingLeft: 48 }}>↳ {group.name}</td><td>{money(group.totals.spend,item.currency)}</td><td>{number.format(group.totals.impressions)}</td><td>{number.format(group.totals.linkClicks || group.totals.clicks)}</td><td>{number.format(group.totals.leads)}</td><td>{pct(group.metrics.ctr)}</td><td>{money(group.metrics.cpc,item.currency)}</td><td>{money(group.metrics.cpl,item.currency)}</td></tr>)}
        </React.Fragment>)}
      </tbody></table></div>
    </section>
  </div>;
}
