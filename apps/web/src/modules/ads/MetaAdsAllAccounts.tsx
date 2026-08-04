import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';

type Totals = { spend: number; impressions: number; clicks: number; linkClicks: number; leads: number };
type Metrics = { ctr: number | null; cpc: number | null; cpl: number | null };
type CurrencyTotal = { currency: string; totals: Totals; metrics: Metrics };
type AdGroup = { id: string; name: string; totals: Totals; metrics: Metrics };
type Campaign = { campaignId: string; campaignName: string; accountId: string; accountName: string; status: string; currency: string; totals: Totals; metrics: Metrics; adGroups: AdGroup[] };
type Account = { accountId: string; accountName: string; currency: string; campaignCount: number; totals: Totals; metrics: Metrics };
type Payload = { range: { since: string; until: string }; currency: string; mixedCurrencies: boolean; totalsByCurrency: CurrencyTotal[]; source: 'canonical' | 'legacy_meta'; totals: Totals; metrics: Metrics; previousTotals: Totals; accounts: Account[]; campaigns: Campaign[]; trend: Array<{ date: string; spend: number; leads: number }>; freshness: { lastMetricDate: string | null; lastSyncedAt: string | null } };

const rangeFor = (days: number) => { const until = new Date(); const since = new Date(); since.setDate(until.getDate() - days + 1); return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }; };
const num = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
const money = (value: number | null, currency = 'KZT') => value == null ? '—' : new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: currency === 'UNKNOWN' || currency === 'MIXED' ? 'KZT' : currency, maximumFractionDigits: 0 }).format(value);
const pct = (value: number | null) => value == null ? '—' : `${num.format(value)}%`;

export function MetaAdsAllAccounts() {
  const [days, setDays] = useState(30);
  const [accountId, setAccountId] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    const range = rangeFor(days);
    setLoading(true); setError('');
    try {
      const account = accountId === 'all' ? '' : `&accountId=${encodeURIComponent(accountId)}`;
      setData(await apiFetch<Payload>(`/marketing/analytics/meta/campaigns?since=${range.since}&until=${range.until}${account}`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить Meta Ads'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [days, accountId]);
  const rows = useMemo(() => (data?.campaigns ?? []).filter((item) => item.campaignName.toLowerCase().includes(query.trim().toLowerCase())), [data, query]);
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const exportCsv = () => {
    const header = ['Кабинет','Валюта','Кампания','Статус','Расход','Показы','Клики','CTR','CPC','Лиды','CPL'];
    const lines = rows.map((item) => [item.accountName,item.currency,item.campaignName,item.status,item.totals.spend,item.totals.impressions,item.totals.linkClicks || item.totals.clicks,item.metrics.ctr ?? '',item.metrics.cpc ?? '',item.totals.leads,item.metrics.cpl ?? ''].join(';'));
    const url = URL.createObjectURL(new Blob([`\uFEFF${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `meta_campaigns_${data?.range.since ?? ''}_${data?.range.until ?? ''}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const staleDays = data?.freshness.lastMetricDate ? Math.floor((Date.now() - new Date(`${data.freshness.lastMetricDate}T00:00:00Z`).getTime()) / 86400000) : 0;
  const selectedAccount = data?.accounts.find((item) => item.accountId === accountId);
  const singleCurrency = accountId !== 'all' ? selectedAccount?.currency : data?.currency;
  const totals = data?.totals;

  return <div style={{ display: 'grid', gap: 16 }}>
    <section className="ads-card" style={{ display: 'grid', gap: 16 }}>
      <div className="ads-panel-head"><div><h2>Meta Ads — все рекламные кабинеты</h2><p>{data ? `${data.range.since} → ${data.range.until} · ${data.accounts.length} кабинетов · ${data.source}` : 'Живые данные через Worker API'}</p></div><div style={{ display: 'flex', gap: 8 }}><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select><button onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Обновить</button><button onClick={exportCsv} disabled={!rows.length}><Download size={14} /> CSV</button></div></div>
      {staleDays > 1 && <div className="ads-empty" style={{ textAlign: 'left' }}><AlertTriangle size={15} /> Последние данные: {data?.freshness.lastMetricDate} ({staleDays} дн. назад).</div>}
      {error && <div className="ads-empty">{error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className={accountId === 'all' ? 'primary' : ''} onClick={() => setAccountId('all')}>Все кабинеты</button>{(data?.accounts ?? []).map((account) => <button key={account.accountId} className={accountId === account.accountId ? 'primary' : ''} onClick={() => setAccountId(account.accountId)}>{account.accountName} · {money(account.totals.spend, account.currency)}</button>)}</div>

      {accountId === 'all' && data?.mixedCurrencies ? <div className="ads-metrics">
        {data.totalsByCurrency.map((group) => <article key={group.currency}><span>Расход · {group.currency}</span><strong>{money(group.totals.spend, group.currency)}</strong><small>{num.format(group.totals.leads)} лидов · CPL {money(group.metrics.cpl, group.currency)}</small></article>)}
      </div> : <div className="ads-metrics"><article><span>Расход</span><strong>{loading ? '—' : money(totals?.spend ?? 0, singleCurrency)}</strong></article><article><span>Показы</span><strong>{loading ? '—' : num.format(totals?.impressions ?? 0)}</strong></article><article><span>Клики</span><strong>{loading ? '—' : num.format((totals?.linkClicks || totals?.clicks) ?? 0)}</strong><small>CTR {pct(data?.metrics.ctr ?? null)}</small></article><article><span>CPC</span><strong>{loading ? '—' : money(data?.metrics.cpc ?? null, singleCurrency)}</strong></article><article><span>Лиды</span><strong>{loading ? '—' : num.format(totals?.leads ?? 0)}</strong><small>CPL {money(data?.metrics.cpl ?? null, singleCurrency)}</small></article></div>}
    </section>

    <section className="ads-card"><div className="ads-card-toolbar" style={{ justifyContent: 'space-between' }}><strong>Кампании ({rows.length})</strong><label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск кампании" /></label></div><div style={{ overflowX: 'auto' }}><table className="ads-performance-table"><thead><tr><th>Кампания</th><th>Валюта</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды</th><th>CTR</th><th>CPC</th><th>CPL</th></tr></thead><tbody>{rows.map((item) => { const key = `${item.accountId}-${item.campaignId}`; return <Fragment key={key}><tr><td><button onClick={() => toggle(key)}>{expanded.has(key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><strong>{item.campaignName}</strong><small style={{ marginLeft: 8 }}>{item.accountName} · {item.status}</small></td><td>{item.currency}</td><td>{money(item.totals.spend,item.currency)}</td><td>{num.format(item.totals.impressions)}</td><td>{num.format(item.totals.linkClicks || item.totals.clicks)}</td><td>{num.format(item.totals.leads)}</td><td>{pct(item.metrics.ctr)}</td><td>{money(item.metrics.cpc,item.currency)}</td><td>{money(item.metrics.cpl,item.currency)}</td></tr>{expanded.has(key) && item.adGroups.map((group) => <tr key={`${key}-${group.id}`}><td style={{ paddingLeft: 48 }}>↳ {group.name}</td><td>{item.currency}</td><td>{money(group.totals.spend,item.currency)}</td><td>{num.format(group.totals.impressions)}</td><td>{num.format(group.totals.linkClicks || group.totals.clicks)}</td><td>{num.format(group.totals.leads)}</td><td>{pct(group.metrics.ctr)}</td><td>{money(group.metrics.cpc,item.currency)}</td><td>{money(group.metrics.cpl,item.currency)}</td></tr>)}</Fragment>; })}</tbody></table></div></section>
  </div>;
}
