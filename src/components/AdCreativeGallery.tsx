import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Eye, Image as ImageIcon, LoaderCircle, Medal, Play, RefreshCw, Search, Sparkles, Trophy } from 'lucide-react';
import AdPreviewDrawer from './AdPreviewDrawer';
import { marketingApi, type AdvertisingAccountCurrency } from '../services/api';

type SortKey = 'best' | 'spend' | 'leads' | 'cpl' | 'ctr' | 'sales';
type AdRow = {
  key: string;
  account_id: string;
  account_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  platform: string;
  source: string;
  status: string;
  creative_type: string;
  date_from: string;
  date_to: string;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  sales: number;
  revenue: number;
  ctr: number;
  cost_per_result: number;
};
type AdResponse = { period?: { from: string; to: string; days: number }; rows: AdRow[] };
type PreviewContent = { imageUrl?: string; thumbnailUrl?: string; videoId?: string; headline?: string; message?: string; callToAction?: string };
type PreviewResponse = { content?: PreviewContent };

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const normalizedPlatform = (value: string) => {
  const provider = (value || '').toLowerCase();
  if (provider.includes('tiktok')) return 'TikTok';
  if (provider.includes('meta') || provider.includes('facebook') || provider.includes('instagram')) return 'Meta';
  return value || 'Не определено';
};
const accountCurrencyKey = (platform: string, id: string) => `${normalizedPlatform(platform)}:${String(id || '').replace(/^act_/, '')}`;
const formatNativeMoney = (value: number, currency?: string | null) => {
  if (!currency) return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0));
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`;
  }
};
const isMeta = (row: AdRow) => /meta|facebook|instagram/.test(`${row.platform || ''} ${row.source || ''}`.toLowerCase());
const isActive = (status: string) => String(status || '').toUpperCase() === 'ACTIVE';
const isVideo = (row: AdRow, preview?: PreviewContent) => Boolean(preview?.videoId) || /video|reel/.test(String(row.creative_type || '').toLowerCase());
const bestScore = (row: AdRow) => Number(row.sales || 0) * 25 + Number(row.leads || 0) * 3 + Math.min(Number(row.ctr || 0), 10) * 2 + Math.log10(Math.max(1, Number(row.impressions || 0)));

const panel: React.CSSProperties = { display: 'grid', gap: 14, padding: 18, border: '1px solid var(--imds-border)', borderRadius: 20, background: 'var(--imds-glass)', boxShadow: 'var(--imds-shadow-soft)' };
const control: React.CSSProperties = { minHeight: 38, padding: '0 10px', border: '1px solid var(--imds-border)', borderRadius: 10, background: 'var(--imds-glass-soft)', color: 'var(--imds-text)', fontSize: 11 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 11 };
const card: React.CSSProperties = { display: 'grid', minWidth: 0, border: '1px solid var(--imds-border)', borderRadius: 16, overflow: 'hidden', background: 'var(--imds-surface)', boxShadow: 'var(--imds-shadow-soft)' };
const mediaButton: React.CSSProperties = { position: 'relative', width: '100%', aspectRatio: '1.08 / 1', border: 0, padding: 0, background: 'var(--imds-surface-2)', color: 'var(--imds-muted)', overflow: 'hidden' };

export default function AdCreativeGallery() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const [rows, setRows] = useState<AdRow[]>([]);
  const [currencies, setCurrencies] = useState<AdvertisingAccountCurrency[]>([]);
  const [previews, setPreviews] = useState<Record<string, PreviewContent>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAd, setSelectedAd] = useState<string | null>(null);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [account, setAccount] = useState('all');
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('best');

  const load = async (nextFrom = from, nextTo = to) => {
    setLoading(true);
    setError('');
    setFailed(new Set());
    try {
      const params = new URLSearchParams({ from: nextFrom, to: nextTo });
      const [response, currencyResponse] = await Promise.all([
        fetch(`/api/analytics/ad-manager?${params}`),
        marketingApi.adCurrencies().catch(() => ({ accounts: [] })),
      ]);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
      const data = JSON.parse(body) as AdResponse;
      setRows(data.rows || []);
      setCurrencies(currencyResponse.accounts || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(monthAgo, today); }, []);

  const currencyByAccount = useMemo(() => new Map(currencies.map((item) => [accountCurrencyKey(item.platform, item.account_id), item.currency.toUpperCase()])), [currencies]);
  const currencyFor = (row: AdRow) => currencyByAccount.get(accountCurrencyKey(row.platform, row.account_id)) || null;
  const platforms = useMemo(() => [...new Set(rows.map((row) => normalizedPlatform(`${row.platform || row.source}`)).filter(Boolean))].sort(), [rows]);
  const accounts = useMemo(() => Array.from(new Map(rows.map((row) => [row.account_id, { id: row.account_id, name: row.account_name, platform: normalizedPlatform(row.platform || row.source) }])).values()).filter((item) => item.id && (platform === 'all' || item.platform === platform)), [rows, platform]);

  const filtered = useMemo(() => {
    let items = rows.filter((row) => row.ad_id);
    if (status === 'active') items = items.filter((row) => isActive(row.status));
    else if (status === 'inactive') items = items.filter((row) => !isActive(row.status));
    if (platform !== 'all') items = items.filter((row) => normalizedPlatform(row.platform || row.source) === platform);
    if (account !== 'all') items = items.filter((row) => row.account_id === account);
    const needle = query.trim().toLowerCase();
    if (needle) items = items.filter((row) => [row.ad_name, row.campaign_name, row.adset_name, row.account_name, row.ad_id].some((value) => String(value || '').toLowerCase().includes(needle)));
    if (kind === 'video') items = items.filter((row) => isVideo(row, previews[row.ad_id]));
    else if (kind === 'image') items = items.filter((row) => !isVideo(row, previews[row.ad_id]));
    return items;
  }, [rows, status, platform, account, kind, query, previews]);

  const topFive = useMemo(() => [...filtered].sort((a, b) => bestScore(b) - bestScore(a)).slice(0, 5), [filtered]);
  const rankByAd = useMemo(() => new Map(topFive.map((row, index) => [row.ad_id, index + 1])), [topFive]);
  const creatives = useMemo(() => [...filtered].sort((a, b) => sort === 'spend'
    ? b.spend - a.spend
    : sort === 'leads'
      ? b.leads - a.leads
      : sort === 'cpl'
        ? (a.cost_per_result || Number.MAX_VALUE) - (b.cost_per_result || Number.MAX_VALUE)
        : sort === 'ctr'
          ? b.ctr - a.ctr
          : sort === 'sales'
            ? b.sales - a.sales
            : bestScore(b) - bestScore(a)).slice(0, 60), [filtered, sort]);

  useEffect(() => {
    const previewPool = [...topFive, ...creatives];
    const targets = previewPool.filter((row, index, all) => all.findIndex((candidate) => candidate.ad_id === row.ad_id) === index).filter((row) => isMeta(row) && !previews[row.ad_id] && !failed.has(row.ad_id)).slice(0, 10);
    if (!targets.length) return;
    let cancelled = false;
    void Promise.allSettled(targets.map(async (row) => {
      const response = await fetch(`/api/analytics/ad-preview?adId=${encodeURIComponent(row.ad_id)}&mode=instagram`);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
      const result = JSON.parse(body) as PreviewResponse;
      return { id: row.ad_id, content: result.content || {} };
    })).then((results) => {
      if (cancelled) return;
      const next: Record<string, PreviewContent> = {};
      const bad: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next[result.value.id] = result.value.content;
        else bad.push(targets[index]?.ad_id || '');
      });
      if (Object.keys(next).length) setPreviews((previous) => ({ ...previous, ...next }));
      if (bad.length) setFailed((previous) => new Set([...previous, ...bad.filter(Boolean)]));
    });
    return () => { cancelled = true; };
  }, [creatives, topFive, previews, failed]);

  const reset = () => {
    setStatus('all');
    setPlatform('all');
    setAccount('all');
    setKind('all');
    setQuery('');
    setSort('best');
    setFrom(monthAgo);
    setTo(today);
    void load(monthAgo, today);
  };

  return <section style={panel}>
    <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ display: 'grid', gap: 5 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 850, letterSpacing: '.12em', color: 'var(--imds-primary)' }}><Sparkles size={14}/> CREATIVE LIBRARY</span>
        <h2 style={{ margin: 0, fontSize: 20 }}>Креативы в работе</h2>
        <p style={{ margin: 0, color: 'var(--imds-muted)', fontSize: 12 }}>Сначала TOP-5 по эффективности, затем вся библиотека с фильтрами и сортировкой.</p>
      </div>
      <button className="button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={15}/>Обновить</button>
    </header>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 9, color: 'var(--imds-muted)' }}>С<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} onBlur={() => void load()} style={control}/></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 9, color: 'var(--imds-muted)' }}>По<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} onBlur={() => void load()} style={control}/></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 9, color: 'var(--imds-muted)' }}>Статус<select value={status} onChange={(e) => setStatus(e.target.value)} style={control}><option value="all">Все</option><option value="active">Активные</option><option value="inactive">Неактивные / пауза</option></select></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 9, color: 'var(--imds-muted)' }}>Платформа<select value={platform} onChange={(e) => { setPlatform(e.target.value); setAccount('all'); }} style={control}><option value="all">Все платформы</option>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 9, color: 'var(--imds-muted)' }}>Кабинет<select value={account} onChange={(e) => setAccount(e.target.value)} style={control}><option value="all">Все кабинеты</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 9, color: 'var(--imds-muted)' }}>Формат<select value={kind} onChange={(e) => setKind(e.target.value)} style={control}><option value="all">Все форматы</option><option value="video">Видео</option><option value="image">Изображения</option></select></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 9, color: 'var(--imds-muted)' }}>Сортировка библиотеки<select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={control}><option value="best">Лучшие</option><option value="sales">Продажи</option><option value="leads">Лиды</option><option value="cpl">Низкий CPL</option><option value="ctr">Высокий CTR</option><option value="spend">Расход</option></select></label>
    </div>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <label style={{ ...control, display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 220 }}><Search size={14}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по креативу, кампании, ID" style={{ border: 0, outline: 0, background: 'transparent', color: 'var(--imds-text)', width: '100%' }}/></label>
      <button className="button" type="button" onClick={reset}><ArrowDownUp size={14}/>Сбросить</button>
    </div>

    {error && <div className="alert alert--error">{error}</div>}
    {loading ? <div className="marketing-hub-empty"><LoaderCircle className="spin" size={18}/> Загружаем креативы…</div> : filtered.length === 0 ? <div className="marketing-hub-empty">По выбранным фильтрам креативов нет.</div> : <>
      <section style={{ display: 'grid', gap: 9, padding: 12, border: '1px solid var(--imds-border)', borderRadius: 16, background: 'var(--imds-primary-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Trophy size={18} color="var(--imds-primary)"/><div><strong style={{ fontSize: 14 }}>TOP-5 креативов</strong><p style={{ margin: '2px 0 0', color: 'var(--imds-muted)', fontSize: 10 }}>Рейтинг за выбранный период и с учётом текущих фильтров</p></div></div>
          <span style={{ color: 'var(--imds-muted)', fontSize: 10 }}>{from} — {to}</span>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {topFive.map((row, index) => {
            const rank = index + 1;
            const preview = previews[row.ad_id];
            const currency = currencyFor(row);
            return <button key={row.ad_id} type="button" onClick={() => isMeta(row) && setSelectedAd(row.ad_id)} disabled={!isMeta(row)} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: '9px 10px', border: rank === 1 ? '1px solid var(--imds-primary)' : '1px solid var(--imds-border)', borderRadius: 11, background: 'var(--imds-surface)', color: 'var(--imds-text)', textAlign: 'left', cursor: isMeta(row) ? 'pointer' : 'default' }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: rank === 1 ? 'var(--imds-primary)' : 'var(--imds-glass-soft)', color: rank === 1 ? '#fff' : 'var(--imds-text)', fontWeight: 900, fontSize: 12 }}>{rank === 1 ? <Trophy size={16}/> : <><Medal size={13}/><small style={{ marginLeft: 2 }}>#{rank}</small></>}</span>
              <span style={{ minWidth: 0, display: 'grid', gap: 2 }}><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{rank}. {row.ad_name || `Ad ${row.ad_id}`}</b><small style={{ color: 'var(--imds-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9 }}>{normalizedPlatform(row.platform || row.source)} · {row.account_name} · {isVideo(row, preview) ? 'Видео' : 'Изображение'}</small></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', fontSize: 9 }}><span><b>{row.sales}</b> продаж</span><span><b>{row.leads}</b> лидов</span><span><b>{row.ctr.toFixed(2)}%</b> CTR</span><span><b>{row.leads ? formatNativeMoney(row.cost_per_result, currency) : '—'}</b> CPL</span></span>
            </button>;
          })}
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 }}><div><strong style={{ fontSize: 13 }}>Все креативы</strong><span style={{ marginLeft: 7, color: 'var(--imds-muted)', fontSize: 10 }}>{creatives.length} показано</span></div></div>
      <div style={grid}>{creatives.map((row) => {
        const preview = previews[row.ad_id];
        const media = preview?.imageUrl || preview?.thumbnailUrl;
        const meta = isMeta(row);
        const currency = currencyFor(row);
        const video = isVideo(row, preview);
        const rank = rankByAd.get(row.ad_id);
        return <article style={{ ...card, outline: rank === 1 ? '2px solid var(--imds-primary)' : 'none' }} key={row.ad_id}>
          <button type="button" style={{ ...mediaButton, cursor: meta ? 'pointer' : 'default' }} onClick={() => meta && setSelectedAd(row.ad_id)} disabled={!meta}>
            {media ? <img src={media} alt={preview?.headline || row.ad_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/> : <div style={{ height: '100%', display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 8, fontSize: 10 }}><ImageIcon size={28}/><span>{meta && !failed.has(row.ad_id) ? 'Загружаем preview…' : 'Preview недоступен'}</span></div>}
            {video && <span style={{ position: 'absolute', left: 9, top: 9, display: 'flex', alignItems: 'center', gap: 4, padding: '5px 7px', borderRadius: 999, background: 'var(--imds-surface)', fontSize: 9, fontWeight: 850 }}><Play size={12} fill="currentColor"/>Видео</span>}
            <span style={{ position: 'absolute', right: 9, top: 9, padding: '5px 7px', borderRadius: 999, background: isActive(row.status) ? 'var(--imds-primary-soft)' : 'var(--imds-surface)', color: isActive(row.status) ? 'var(--imds-success)' : 'var(--imds-muted)', fontSize: 9, fontWeight: 850 }}>{row.status || 'UNKNOWN'}</span>
            {rank && <span style={{ position: 'absolute', right: 9, bottom: 9, padding: '5px 8px', borderRadius: 999, background: rank === 1 ? 'var(--imds-primary)' : 'var(--imds-surface)', color: rank === 1 ? '#fff' : 'var(--imds-text)', border: rank === 1 ? 'none' : '1px solid var(--imds-border)', fontSize: 9, fontWeight: 900 }}>TOP #{rank}</span>}
          </button>
          <div style={{ display: 'grid', gap: 4, padding: '12px 12px 8px' }}><small style={{ color: 'var(--imds-muted)', fontSize: 9 }}>{normalizedPlatform(row.platform || row.source)} · {row.account_name || 'Кабинет'}{currency ? ` · ${currency}` : ''}</small><strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.ad_name || `Ad ${row.ad_id}`}</strong><p style={{ margin: 0, color: 'var(--imds-text-soft)', fontSize: 10, lineHeight: 1.4, minHeight: 28 }}>{preview?.headline || preview?.message || `${row.campaign_name || 'Кампания'} · ${row.adset_name || 'Группа'}`}</p><small style={{ fontSize: 8, color: 'var(--imds-muted)' }}>Данные: {row.date_from || from} — {row.date_to || to}</small></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, padding: '6px 12px 12px' }}>{[['Расход', formatNativeMoney(row.spend, currency)], ['Лиды', number(row.leads)], ['Продажи', number(row.sales)], ['CPL', row.leads ? formatNativeMoney(row.cost_per_result, currency) : '—'], ['CTR', `${row.ctr.toFixed(2)}%`], ['Показы', number(row.impressions)]].map(([label, value]) => <span key={label} style={{ display: 'grid', gap: 2, padding: '7px 8px', borderRadius: 9, background: 'var(--imds-glass-soft)' }}><small style={{ fontSize: 8, color: 'var(--imds-muted)' }}>{label}</small><b style={{ fontSize: 10 }}>{value}</b></span>)}</div>
          <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--imds-border)', padding: '9px 12px', color: 'var(--imds-muted)', fontSize: 8 }}><span>ID {row.ad_id}</span>{meta ? <button type="button" className="marketing-hub-text-button" onClick={() => setSelectedAd(row.ad_id)} style={{ fontSize: 9 }}><Eye size={13}/>Preview</button> : <span>Preview не подключён</span>}</footer>
        </article>;
      })}</div>
    </>}
    <AdPreviewDrawer adId={selectedAd} onClose={() => setSelectedAd(null)}/>
  </section>;
}
