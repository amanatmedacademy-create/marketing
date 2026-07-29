import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, LoaderCircle, Search } from 'lucide-react';
import '../full-analytics-data.css';

type Campaign = Record<string, string | number | boolean | null | undefined> & {
  key:string; platform:string; source:string; campaign_id:string; campaign_name:string;
  utm_source:string; utm_medium:string; utm_campaign:string;
  spend:number; revenue:number; impressions:number; reach:number; clicks:number; link_clicks:number;
  ads_leads:number; crm_leads:number; target_leads:number; in_work:number; rejected:number;
  appointments:number; arrived:number; deals_in_work:number; deals_rejected:number; sales:number;
  active_days:number; roas:number; cpl:number; cpm:number; ctr:number; link_ctr:number; frequency:number; recommendation:string;
};

type AnalyticsData = {
  period:{from:string;to:string;days:number};
  campaigns:Campaign[];
  attribution:{total_leads?:number;unattributed_leads?:number;unattributed_rate?:number};
  unavailable?:string[];
};

const number = (value:number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(Number(value || 0));
const decimal = (value:number) => Number(value || 0).toFixed(2);

const columns:Array<{key:keyof Campaign;label:string;format?:(value:number)=>string}> = [
  {key:'platform',label:'Платформа'}, {key:'source',label:'Источник'}, {key:'campaign_name',label:'Кампания'}, {key:'campaign_id',label:'ID кампании'},
  {key:'utm_source',label:'UTM Source'}, {key:'utm_medium',label:'UTM Medium'}, {key:'utm_campaign',label:'UTM Campaign'},
  {key:'active_days',label:'Активных дней',format:number}, {key:'spend',label:'Расход',format:money}, {key:'revenue',label:'Выручка',format:money},
  {key:'roas',label:'ROAS',format:(v)=>`${decimal(v)}x`}, {key:'impressions',label:'Показы',format:number}, {key:'reach',label:'Охват',format:number},
  {key:'frequency',label:'Частота',format:decimal}, {key:'clicks',label:'Клики',format:number}, {key:'link_clicks',label:'Клики по ссылке',format:number},
  {key:'ctr',label:'CTR общий',format:(v)=>`${decimal(v)}%`}, {key:'link_ctr',label:'CTR ссылки',format:(v)=>`${decimal(v)}%`}, {key:'cpm',label:'CPM',format:money},
  {key:'ads_leads',label:'Лиды рекламы',format:number}, {key:'crm_leads',label:'Лиды CRM',format:number}, {key:'cpl',label:'CPL CRM',format:money},
  {key:'target_leads',label:'Целевые',format:number}, {key:'in_work',label:'В работе',format:number}, {key:'rejected',label:'Брак',format:number},
  {key:'appointments',label:'Записаны',format:number}, {key:'arrived',label:'Пришли',format:number}, {key:'deals_in_work',label:'Сделки в работе',format:number},
  {key:'deals_rejected',label:'Отказы по сделкам',format:number}, {key:'sales',label:'Продажи',format:number}, {key:'recommendation',label:'Рекомендация'},
];

function csvCell(value:unknown) {
  const text = String(value ?? '').replace(/"/g,'""');
  return `"${text}"`;
}

export default function FullAnalyticsData({ days = 30 }: { days?: number }) {
  const [data,setData] = useState<AnalyticsData|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [query,setQuery] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/analytics/overview?days=${days}`)
      .then(async response => {
        const body = await response.text();
        if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
        return JSON.parse(body) as AnalyticsData;
      })
      .then(result => active && setData(result))
      .catch(reason => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [days]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.campaigns || [];
    return (data?.campaigns || []).filter(row => [row.platform,row.source,row.campaign_name,row.campaign_id,row.utm_source,row.utm_medium,row.utm_campaign,row.recommendation].some(value => String(value || '').toLowerCase().includes(needle)));
  }, [data,query]);

  const totals = useMemo(() => rows.reduce((acc,row) => ({
    spend:acc.spend + Number(row.spend||0), revenue:acc.revenue + Number(row.revenue||0), impressions:acc.impressions + Number(row.impressions||0),
    reach:acc.reach + Number(row.reach||0), clicks:acc.clicks + Number(row.clicks||0), link_clicks:acc.link_clicks + Number(row.link_clicks||0),
    ads_leads:acc.ads_leads + Number(row.ads_leads||0), crm_leads:acc.crm_leads + Number(row.crm_leads||0), target_leads:acc.target_leads + Number(row.target_leads||0),
    appointments:acc.appointments + Number(row.appointments||0), arrived:acc.arrived + Number(row.arrived||0), sales:acc.sales + Number(row.sales||0),
  }), {spend:0,revenue:0,impressions:0,reach:0,clicks:0,link_clicks:0,ads_leads:0,crm_leads:0,target_leads:0,appointments:0,arrived:0,sales:0}), [rows]);

  const exportCsv = () => {
    const header = columns.map(column => csvCell(column.label)).join(';');
    const body = rows.map(row => columns.map(column => csvCell(row[column.key])).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${header}\n${body}`],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `imds-marketing-all-data-${data?.period.from || ''}-${data?.period.to || ''}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <section className="full-data-panel full-data-state"><LoaderCircle className="spin" size={20}/>Загружаем полный набор данных…</section>;
  if (error) return <section className="full-data-panel full-data-state full-data-error"><AlertTriangle size={20}/>{error}</section>;
  if (!data) return null;

  return <section className="full-data-panel">
    <header className="full-data-head">
      <div><span>Полная выгрузка</span><h2>Все данные аналитики</h2><p>Все доступные рекламные, UTM и CRM-показатели без сокращения колонок.</p></div>
      <button type="button" onClick={exportCsv}><Download size={16}/>Экспорт CSV</button>
    </header>

    <div className="full-data-health">
      <article><span>Всего кампаний</span><strong>{number(rows.length)}</strong></article>
      <article><span>Расход</span><strong>{money(totals.spend)}</strong></article>
      <article><span>Выручка</span><strong>{money(totals.revenue)}</strong></article>
      <article><span>Показы</span><strong>{number(totals.impressions)}</strong></article>
      <article><span>Лиды CRM</span><strong>{number(totals.crm_leads)}</strong></article>
      <article><span>Продажи</span><strong>{number(totals.sales)}</strong></article>
      <article className={(data.attribution.unattributed_rate || 0) > 5 ? 'warning' : ''}><span>Без атрибуции</span><strong>{decimal(data.attribution.unattributed_rate || 0)}%</strong></article>
    </div>

    {Boolean(data.unavailable?.length) && <div className="full-data-warning"><AlertTriangle size={16}/><span>Недоступные источники: {data.unavailable?.join(', ')}</span></div>}

    <div className="full-data-tools"><label><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск по платформе, кампании, UTM или рекомендации"/></label><span>Показано {number(rows.length)} записей</span></div>

    <div className="full-data-table"><table><thead><tr>{columns.map(column => <th key={String(column.key)}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.key}>{columns.map(column => { const value = row[column.key]; return <td key={String(column.key)}>{column.format && typeof value === 'number' ? column.format(value) : String(value ?? '—')}</td>; })}</tr>)}</tbody><tfoot><tr>{columns.map((column,index) => <td key={String(column.key)}>{index===0?'ИТОГО':column.key==='spend'?money(totals.spend):column.key==='revenue'?money(totals.revenue):column.key==='impressions'?number(totals.impressions):column.key==='reach'?number(totals.reach):column.key==='clicks'?number(totals.clicks):column.key==='link_clicks'?number(totals.link_clicks):column.key==='ads_leads'?number(totals.ads_leads):column.key==='crm_leads'?number(totals.crm_leads):column.key==='target_leads'?number(totals.target_leads):column.key==='appointments'?number(totals.appointments):column.key==='arrived'?number(totals.arrived):column.key==='sales'?number(totals.sales):'—'}</td>)}</tr></tfoot></table></div>
  </section>;
}
