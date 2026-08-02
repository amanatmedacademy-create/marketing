import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, LoaderCircle, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';
import { useActionFeedback } from '../system/ActionFeedback';
import './meta-ads-insights.css';

type Insight = {
  ad_account_id: string;
  insight_date: string;
  currency: string | null;
  spend: number | string;
  impressions: number | string;
  reach: number | string;
  clicks: number | string;
  inline_link_clicks: number | string;
  leads: number | string;
  purchases: number | string;
  purchase_value: number | string;
  synced_at: string;
};

type InsightsResponse = {
  insights: Insight[];
  range: { since: string; until: string };
};

const number = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
const money = (value: number, currency: string) => new Intl.NumberFormat('ru-KZ', {
  style: 'currency',
  currency: currency || 'KZT',
  maximumFractionDigits: 0,
}).format(value);

function dateRange(days: number) {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - (days - 1));
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

export function MetaAdsInsightsPanel({ compact = false }: { compact?: boolean }) {
  const feedback = useActionFeedback();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const range = dateRange(days);
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<InsightsResponse>(`/integrations/meta/ads/insights?since=${range.since}&until=${range.until}`);
      setRows(payload.insights ?? []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Не удалось загрузить Meta Ads insights';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [days]);

  async function sync() {
    const range = dateRange(days);
    setSyncing(true);
    try {
      const result = await apiFetch<{ success: boolean; accounts: number; rows: number }>('/integrations/meta/ads/sync', {
        method: 'POST',
        body: range,
      });
      feedback.success('Meta Ads синхронизирован', `Кабинетов: ${result.accounts}. Строк: ${result.rows}.`);
      await load();
    } catch (syncError) {
      feedback.error('Синхронизация Meta Ads не выполнена', syncError instanceof Error ? syncError.message : 'Неизвестная ошибка');
    } finally {
      setSyncing(false);
    }
  }

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.spend += Number(row.spend || 0);
    acc.impressions += Number(row.impressions || 0);
    acc.reach += Number(row.reach || 0);
    acc.clicks += Number(row.clicks || 0);
    acc.linkClicks += Number(row.inline_link_clicks || 0);
    acc.leads += Number(row.leads || 0);
    acc.purchases += Number(row.purchases || 0);
    acc.purchaseValue += Number(row.purchase_value || 0);
    return acc;
  }, { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, leads: 0, purchases: 0, purchaseValue: 0 }), [rows]);

  const currency = rows.find(row => row.currency)?.currency || 'KZT';
  const ctr = totals.impressions ? totals.linkClicks / totals.impressions * 100 : 0;
  const cpl = totals.leads ? totals.spend / totals.leads : 0;
  const cpc = totals.linkClicks ? totals.spend / totals.linkClicks : 0;
  const roas = totals.spend ? totals.purchaseValue / totals.spend : 0;
  const accounts = new Set(rows.map(row => row.ad_account_id)).size;
  const lastSync = rows.map(row => row.synced_at).sort().at(-1);

  return <section className={`meta-ads-live ${compact ? 'compact' : ''}`}>
    <header>
      <div className="meta-ads-live-title"><span><BarChart3 size={19} /></span><div><strong>Meta Ads — фактические данные</strong><small>{accounts ? `${accounts} рекламных кабинетов` : 'Подключённые кабинеты пока не синхронизированы'}{lastSync ? ` · обновлено ${new Date(lastSync).toLocaleString('ru-RU')}` : ''}</small></div></div>
      <div className="meta-ads-live-actions">
        <select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select>
        <button disabled={loading} onClick={() => void load()}>{loading ? <LoaderCircle className="auth-spinner" size={15} /> : <RefreshCw size={15} />} Обновить</button>
        <button className="primary" disabled={syncing} onClick={() => void sync()}>{syncing ? <LoaderCircle className="auth-spinner" size={15} /> : <RefreshCw size={15} />} {syncing ? 'Синхронизация…' : 'Синхронизировать Meta'}</button>
      </div>
    </header>

    {error ? <div className="meta-ads-live-error"><AlertCircle size={17} /><div><strong>Статистика Meta Ads недоступна</strong><span>{error}</span></div></div> : <div className="meta-ads-live-grid">
      <article><span>Расход</span><strong>{loading ? '—' : money(totals.spend, currency)}</strong><small>{days} дней</small></article>
      <article><span>Показы</span><strong>{loading ? '—' : number.format(totals.impressions)}</strong><small>Охват {number.format(totals.reach)}</small></article>
      <article><span>Клики</span><strong>{loading ? '—' : number.format(totals.linkClicks)}</strong><small>CTR {number.format(ctr)}%</small></article>
      <article><span>Лиды Meta</span><strong>{loading ? '—' : number.format(totals.leads)}</strong><small>CPL {totals.leads ? money(cpl, currency) : '—'}</small></article>
      <article><span>CPC</span><strong>{loading || !totals.linkClicks ? '—' : money(cpc, currency)}</strong><small>По link clicks</small></article>
      <article><span>Покупки Meta</span><strong>{loading ? '—' : number.format(totals.purchases)}</strong><small>ROAS {totals.spend ? number.format(roas) : '—'}</small></article>
    </div>}
  </section>;
}
