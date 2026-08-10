import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Download, RefreshCw, UsersRound } from 'lucide-react';
import { convertCurrency, formatCurrency } from '../currency';
import { marketingApi, type AdSummaryRow, type AdvertisingAccountCurrency, type DashboardDailyRow, type SourceSummaryRow } from '../services/api';
import '../marketing-suite.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => formatCurrency(Number(value || 0), 'KZT');
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const platformName = (value?: string | null) => normalize(value).includes('tiktok') ? 'TikTok' : normalize(value).includes('meta') || normalize(value).includes('facebook') || normalize(value).includes('instagram') ? 'Meta' : String(value || 'Не определено');

function csvEscape(value: unknown): string { const text = String(value ?? ''); return `"${text.replace(/"/g, '""')}"`; }
function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = '\ufeff' + rows.map(row => row.map(csvEscape).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [daily, setDaily] = useState<DashboardDailyRow[]>([]);
  const [sources, setSources] = useState<SourceSummaryRow[]>([]);
  const [ads, setAds] = useState<AdSummaryRow[]>([]);
  const [currencies, setCurrencies] = useState<AdvertisingAccountCurrency[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({ KZT: 1 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      const [dailyRows, sourceRows, adRows, currencyRows, rateRows] = await Promise.all([
        marketingApi.dashboard(), marketingApi.sources(), marketingApi.ads(),
        marketingApi.adCurrencies().catch(() => ({ accounts: [] })),
        marketingApi.exchangeRates().catch(() => ({ base: 'KZT' as const, rates: { KZT: 1 }, updatedAt: null })),
      ]);
      setDaily(dailyRows); setSources(sourceRows); setAds(adRows); setCurrencies(currencyRows.accounts); setRates({ ...rateRows.rates, KZT: 1 });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось загрузить отчёт'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => daily.reduce((acc, row) => ({
    leads: acc.leads + Number(row.leads || 0),
    target: acc.target + Number(row.target_leads || 0),
    arrived: acc.arrived + Number(row.arrived || 0),
    sales: acc.sales + Number(row.sales || 0),
    revenue: acc.revenue + Number(row.revenue || 0),
  }), { leads: 0, target: 0, arrived: 0, sales: 0, revenue: 0 }), [daily]);

  const currencyByAccount = useMemo(() => new Map(currencies.map(item => [`${platformName(item.platform)}:${String(item.account_id).replace(/^act_/, '')}`, item.currency.toUpperCase()])), [currencies]);
  const platformCurrency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    currencies.forEach(item => { const key = platformName(item.platform); const set = map.get(key) || new Set<string>(); set.add(item.currency.toUpperCase()); map.set(key, set); });
    return new Map([...map.entries()].map(([key, set]) => [key, set.size === 1 ? [...set][0] : null]));
  }, [currencies]);
  const spendKzt = useMemo(() => ads.reduce((sum, row) => {
    const platform = platformName(row.platform);
    const accountId = String(row.account_id || '').replace(/^act_/, '');
    const currency = currencyByAccount.get(`${platform}:${accountId}`) || platformCurrency.get(platform);
    if (!currency) return sum;
    return sum + (convertCurrency(Number(row.spend || 0), currency, 'KZT', rates) || 0);
  }, 0), [ads, currencyByAccount, platformCurrency, rates]);
  const roas = spendKzt ? totals.revenue / spendKzt : 0;

  const exportSources = () => downloadCsv(`imds-marketing-sources-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Источник', 'Платформа', 'Лиды', 'Целевые', 'Пришли', 'Продажи', 'Выручка CRM'],
    ...sources.map(row => [row.source, row.platform, row.leads, row.target_leads, row.arrived, row.sales, row.revenue]),
  ]);

  return <div className="stack suite-page">
    <div className="suite-page-head"><div><span>Reporting</span><h1>Отчёты</h1><p>CRM-показатели и рекламный расход приведены к одной валюте. Нативные расходы разных рекламных кабинетов не суммируются как будто это одна валюта.</p></div><div><button className="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>{loading ? 'Обновление…' : 'Обновить'}</button><button className="button" onClick={exportSources} disabled={!sources.length}><Download size={16}/>CSV</button></div></div>
    {message && <div className="alert">{message}</div>}
    <div className="suite-kpis"><article><UsersRound/><span>Лиды</span><strong>{loading ? '—' : number(totals.leads)}</strong></article><article><CheckCircle2/><span>Продажи</span><strong>{loading ? '—' : number(totals.sales)}</strong></article><article><BarChart3/><span>Расход, KZT</span><strong>{loading ? '—' : spendKzt ? money(spendKzt) : '—'}</strong></article><article><BarChart3/><span>Выручка CRM</span><strong>{loading ? '—' : money(totals.revenue)}</strong><small>{!loading && spendKzt ? `ROAS ${roas.toFixed(2)}x` : ''}</small></article></div>
    <section className="panel"><h2>CRM-результаты по источникам</h2>{loading ? <div className="suite-state">Формируем отчёт…</div> : !sources.length ? <div className="suite-state">Нет данных по источникам.</div> : <div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Выручка CRM</th></tr></thead><tbody>{sources.map(row => <tr key={`${row.source}-${row.platform}`}><td><b>{row.source || 'Без источника'}</b></td><td>{row.platform || '—'}</td><td>{number(row.leads)}</td><td>{number(row.target_leads)}</td><td>{number(row.arrived)}</td><td>{number(row.sales)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
