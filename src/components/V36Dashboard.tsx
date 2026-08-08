import { Fragment, useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, Filter, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { formatCurrency } from '../currency';
import { marketingApi } from '../services/api';
import '../v36-dashboard.css';

type Level = 'platform' | 'account' | 'campaign' | 'adset' | 'ad';
type AnalyticsRow = {
  key:string; parent_key:string|null; level:Level; label:string; platform:string; source:string;
  account_id:string; account_name:string; campaign_id:string; campaign_name:string;
  adset_id:string; adset_name:string; ad_id:string; ad_name:string;
  utm_source:string; utm_medium:string; utm_campaign:string; utm_content:string;
  spend:number; revenue:number; impressions:number; reach:number; clicks:number; link_clicks:number;
  ads_leads:number; crm_leads:number; target_leads:number; in_work:number; rejected:number;
  appointments:number; arrived:number; deals_in_work:number; deals_rejected:number; sales:number;
  roas:number; romi:number; cpl:number; cost_per_target:number; cost_per_appointment:number;
  cost_per_arrival:number; cac:number; cpm:number; cpc:number; ctr:number; link_ctr:number;
  frequency:number; recommendation:string; active_days?:number; spend_currency?:string;
};
type Platform = AnalyticsRow & { campaigns:number; leads:number; sale_rate:number };
type Data = {
  period:{from:string;to:string};
  totals:{leads:number;target_leads:number;arrived:number;sales:number;spend:number;revenue:number};
  daily:Array<{date:string;leads:number;sales:number;spend:number}>;
  platforms:Platform[]; campaigns:AnalyticsRow[]; hierarchy:AnalyticsRow[];
  hourly:Array<{hour:number;leads:number;appointments:number;rate:number}>;
  weekdays:Array<{day:number;leads:number;appointments:number;rate:number}>;
  delays:Array<{day:number;appointments:number;rate:number}>;
  attribution:{total_leads?:number;unattributed_leads:number;unattributed_rate:number};
};

type Totals = { leads:number; target_leads:number; appointments:number; arrived:number; sales:number; spend:number; spendCurrency:string; revenue:number };

const empty:Data = { period:{from:'',to:''}, totals:{leads:0,target_leads:0,arrived:0,sales:0,spend:0,revenue:0}, daily:[], platforms:[], campaigns:[], hierarchy:[], hourly:[], weekdays:[], delays:[], attribution:{unattributed_leads:0,unattributed_rate:0} };
const money = (value:number) => formatCurrency(value,'KZT');
const num = (value:number) => new Intl.NumberFormat('ru-RU').format(value||0);
const pct = (value:number,total:number) => total ? `${Math.round(value*100/total)}%` : '0%';
const colors = ['#2563eb','#ec4899','#f97316','#0ea5e9','#22c55e','#14b8a6','#8b5cf6'];
const week = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const normalize = (value:string) => (value || '').trim().toLowerCase();
const platformName = (value:string) => normalize(value).includes('tiktok') ? 'TikTok' : normalize(value).includes('meta') || normalize(value).includes('facebook') || normalize(value).includes('instagram') ? 'Meta' : value || 'Не определено';
const accountKey = (platform:string, id:string, name:string) => `${platformName(platform)}::${id || name}`;
const levelNames:Record<Level,string> = { platform:'Платформа', account:'Кабинет', campaign:'Кампания', adset:'Группа', ad:'Объявление' };
const levelDepth:Record<Level,number> = { platform:0, account:1, campaign:2, adset:3, ad:4 };

export default function V36Dashboard() {
  const [days,setDays] = useState(7);
  const [data,setData] = useState<Data>(empty);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [mode,setMode] = useState<'ads'|'crm'>('ads');
  const [open,setOpen] = useState<Record<string,boolean>>({});
  const [platformMenu,setPlatformMenu] = useState(false);
  const [accountMenu,setAccountMenu] = useState(false);
  const [sourceMenu,setSourceMenu] = useState(false);
  const [utmMenu,setUtmMenu] = useState(false);
  const [platforms,setPlatforms] = useState<string[]>([]);
  const [accounts,setAccounts] = useState<string[]>([]);
  const [sources,setSources] = useState<string[]>([]);
  const [utmSource,setUtmSource] = useState('');
  const [utmMedium,setUtmMedium] = useState('');
  const [utmCampaign,setUtmCampaign] = useState('');
  const [utmContent,setUtmContent] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/analytics/overview?days=${days}`);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
      setData({ ...empty, ...JSON.parse(body) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setData(empty);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [days]);

  const campaigns = data.campaigns || [];
  const hierarchy = data.hierarchy || [];
  // Расход показывается в исходной валюте кабинета (spend_currency из API),
  // без конвертации: $1 остаётся $1, а не подписывается как 1 ₸.
  const MIXED = 'MIXED';
  const spendOf = (row:AnalyticsRow) => Number(row.spend||0);
  const currencyOf = (row:AnalyticsRow) => row.spend_currency || 'KZT';
  const mergeCurrency = (current:string,incoming:string) => !current ? incoming : current === incoming ? current : MIXED;
  const moneyIn = (value:number,currency:string) => currency === MIXED ? '—' : formatCurrency(value,currency);
  const platformOptions = useMemo(() => Array.from(new Set(campaigns.map((item) => item.platform).filter(Boolean))), [campaigns]);
  const accountOptions = useMemo(() => Array.from(new Map(
    hierarchy.filter((item) => item.level === 'account').map((item) => {
      const id = accountKey(item.platform,item.account_id,item.account_name);
      return [id,{id,name:item.account_name || item.account_id,rawId:item.account_id,platform:item.platform}];
    }),
  ).values()).sort((a,b) => a.platform.localeCompare(b.platform,'ru') || a.name.localeCompare(b.name,'ru')), [hierarchy]);
  const sourceOptions = useMemo(() => Array.from(new Set(campaigns.map((item) => item.source || item.platform).filter(Boolean))), [campaigns]);
  const matchingCampaigns = useMemo(() => campaigns.filter((item) => {
    if (platforms.length && !platforms.includes(item.platform)) return false;
    if (accounts.length && !accounts.includes(accountKey(item.platform,item.account_id,item.account_name))) return false;
    if (sources.length && !sources.includes(item.source || item.platform)) return false;
    if (utmSource && !normalize(item.utm_source).includes(normalize(utmSource))) return false;
    if (utmMedium && !normalize(item.utm_medium).includes(normalize(utmMedium))) return false;
    if (utmCampaign && ![item.utm_campaign,item.campaign_name,item.campaign_id].some((value) => normalize(value).includes(normalize(utmCampaign)))) return false;
    if (utmContent && !normalize(item.utm_content).includes(normalize(utmContent))) return false;
    return true;
  }), [campaigns,platforms,accounts,sources,utmSource,utmMedium,utmCampaign,utmContent]);

  const allowedPrefixes = useMemo(() => matchingCampaigns.map((row) => row.key), [matchingCampaigns]);
  const filteredHierarchy = useMemo(() => {
    if (!platforms.length && !accounts.length && !sources.length && !utmSource && !utmMedium && !utmCampaign && !utmContent) return hierarchy;
    return hierarchy.filter((row) => allowedPrefixes.some((campaignKey) => campaignKey.startsWith(row.key) || row.key.startsWith(campaignKey)));
  }, [hierarchy,allowedPrefixes,platforms,accounts,sources,utmSource,utmMedium,utmCampaign,utmContent]);

  const children = useMemo(() => {
    const map = new Map<string|null,AnalyticsRow[]>();
    filteredHierarchy.forEach((row) => {
      const rows = map.get(row.parent_key) || [];
      rows.push(row);
      map.set(row.parent_key, rows);
    });
    for (const rows of map.values()) rows.sort((a,b) => spendOf(b)-spendOf(a) || a.label.localeCompare(b.label,'ru'));
    return map;
  }, [filteredHierarchy]);

  const totals = useMemo<Totals>(() => matchingCampaigns.reduce<Totals>((acc,row) => {
    const spend = spendOf(row);
    return {
      leads:acc.leads+Number(row.crm_leads||0), target_leads:acc.target_leads+Number(row.target_leads||0), appointments:acc.appointments+Number(row.appointments||0),
      arrived:acc.arrived+Number(row.arrived||0), sales:acc.sales+Number(row.sales||0), revenue:acc.revenue+Number(row.revenue||0),
      spend:acc.spend+spend, spendCurrency:spend>0?mergeCurrency(acc.spendCurrency,currencyOf(row)):acc.spendCurrency,
    };
  },{leads:0,target_leads:0,appointments:0,arrived:0,sales:0,spend:0,spendCurrency:'',revenue:0}),[matchingCampaigns]);

  const visiblePlatforms = useMemo(() => Array.from(new Map(matchingCampaigns.map((row) => [row.platform,row.platform])).values()).map((platform,index) => {
    const rows = matchingCampaigns.filter((row) => row.platform===platform);
    const leads = rows.reduce((sum,row) => sum+Number(row.crm_leads||0),0);
    const sales = rows.reduce((sum,row) => sum+Number(row.sales||0),0);
    const spend = rows.reduce((sum,row) => sum+spendOf(row),0);
    const spendCurrency = rows.reduce((current,row) => spendOf(row)>0?mergeCurrency(current,currencyOf(row)):current,'');
    return {key:`${platform}-${index}`,platform,leads,sales,spend,spendCurrency,sale_rate:leads?sales*100/leads:0};
  }),[matchingCampaigns]);

  const activeFilters = platforms.length + accounts.length + sources.length + Number(Boolean(utmSource)) + Number(Boolean(utmMedium)) + Number(Boolean(utmCampaign)) + Number(Boolean(utmContent));
  const chart = data.daily.map((item) => ({ ...item, label:new Date(`${item.date}T00:00:00`).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}) }));
  const clearFilters = () => { setPlatforms([]); setAccounts([]); setSources([]); setUtmSource(''); setUtmMedium(''); setUtmCampaign(''); setUtmContent(''); };
  const setAllOpen = (value:boolean) => setOpen(Object.fromEntries(filteredHierarchy.filter((row) => row.level!=='ad').map((row) => [row.key,value])));
  const heatClass = (rate:number) => rate >= 35 ? 'heat-high' : rate >= 20 ? 'heat-mid' : rate >= 10 ? 'heat-low' : 'heat-bad';
  const hasChildren = (row:AnalyticsRow) => Boolean(children.get(row.key)?.length);
  const financialFor = (row:AnalyticsRow) => {
    const sourceRows = row.level==='campaign' ? [row] : matchingCampaigns.filter((campaign) => campaign.key.startsWith(`${row.key}|`) || campaign.key===row.key);
    const spend = sourceRows.reduce((sum,campaign) => sum+spendOf(campaign),0);
    const currency = sourceRows.reduce((current,campaign) => spendOf(campaign)>0?mergeCurrency(current,currencyOf(campaign)):current,'');
    const revenue = sourceRows.length ? sourceRows.reduce((sum,campaign) => sum+Number(campaign.revenue||0),0) : Number(row.revenue||0);
    const comparable = spend>0 && (currency==='KZT'||currency==='');
    return {spend,currency:currency||'KZT',single:currency!==MIXED,revenue,roas:comparable?revenue/spend:null,romi:comparable?(revenue-spend)*100/spend:null};
  };
  const recommendation = (row:AnalyticsRow,roas:number|null) => {
    if (roas===null) return 'Расход в валюте кабинета';
    if ((row.active_days||0)<4 || row.crm_leads<10) return 'Недостаточно данных';
    const targetRate=row.crm_leads?row.target_leads*100/row.crm_leads:0;
    if(roas>=3.5&&targetRate>=55) return 'Масштабировать';
    if(roas>=2&&targetRate>=45) return 'Растить';
    if(roas>=1.5&&targetRate>=35) return 'Наблюдать';
    return 'Отключить';
  };

  const renderRow = (row:AnalyticsRow):React.ReactNode => {
    const nested = children.get(row.key) || [];
    const expanded = Boolean(open[row.key]);
    const financial=financialFor(row);
    const spend=financial.single?moneyIn(financial.spend,financial.currency):'—';
    const unitCosts={cpl:row.crm_leads?financial.spend/row.crm_leads:0,target:row.target_leads?financial.spend/row.target_leads:0,appointment:row.appointments?financial.spend/row.appointments:0,arrival:row.arrived?financial.spend/row.arrived:0,cac:row.sales?financial.spend/row.sales:0};
    return <Fragment key={row.key}>
      <tr className={`v36-hierarchy-row v36-level-${row.level}`}>
        <td><div className="v36-tree-label" style={{paddingLeft:`${levelDepth[row.level]*18}px`}}>{hasChildren(row) ? <button type="button" className="v36-tree-toggle" onClick={() => setOpen((previous) => ({...previous,[row.key]:!previous[row.key]}))}><ChevronRight className={expanded?'open':''} size={14}/></button> : <span className="v36-tree-spacer"/>}<div><b>{row.label || 'Без названия'}</b><small>{levelNames[row.level]}{row.level==='account'&&row.account_id?` · ${row.account_id}`:''}{row.level==='campaign'&&row.campaign_id?` · ${row.campaign_id}`:''}{row.level==='adset'&&row.adset_id?` · ${row.adset_id}`:''}{row.level==='ad'&&row.ad_id?` · ${row.ad_id}`:''}</small></div></div></td>
        {mode==='ads' ? <><td>{row.utm_source||'—'}</td><td>{row.utm_medium||'—'}</td><td>{row.utm_campaign||'—'}</td><td>{row.utm_content||'—'}</td><td>{financial.roas===null?'—':`${financial.roas.toFixed(2)}x`}</td><td>{financial.romi===null?'—':`${financial.romi.toFixed(0)}%`}</td><td>{spend}</td><td>{money(financial.revenue)}</td><td>{num(row.impressions)}</td><td>{num(row.reach)}*</td><td>{num(row.clicks)}</td><td>{row.ctr.toFixed(2)}%</td><td>{financial.single&&row.clicks?moneyIn(financial.spend/row.clicks,financial.currency):'—'}</td><td>{financial.single&&row.impressions?moneyIn(financial.spend*1000/row.impressions,financial.currency):'—'}</td><td>{row.frequency.toFixed(2)}*</td><td>{recommendation(row,financial.roas)}</td></> : <><td>{num(row.ads_leads)}</td><td>{num(row.crm_leads)}</td><td>{num(row.target_leads)}</td><td>{num(row.appointments)}</td><td>{num(row.arrived)}</td><td>{num(row.sales)}</td><td>{pct(row.target_leads,row.crm_leads)}</td><td>{pct(row.appointments,row.target_leads)}</td><td>{pct(row.arrived,row.appointments)}</td><td>{pct(row.sales,row.arrived)}</td><td>{financial.single?moneyIn(unitCosts.cpl,financial.currency):'—'}</td><td>{financial.single?moneyIn(unitCosts.target,financial.currency):'—'}</td><td>{financial.single?moneyIn(unitCosts.appointment,financial.currency):'—'}</td><td>{financial.single?moneyIn(unitCosts.arrival,financial.currency):'—'}</td><td>{financial.single?moneyIn(unitCosts.cac,financial.currency):'—'}</td><td>{money(financial.revenue)}</td></>}
      </tr>{expanded && nested.map(renderRow)}
    </Fragment>;
  };

  return <main className="v36-dashboard">
    <section className="v36-toolbar">
      <div className="v36-periods">{[3,7,15,30].map((value) => <button key={value} className={days===value?'active':''} onClick={() => setDays(value)}>{value} {value===3?'дня':'дней'}</button>)}</div>
      <div className="v36-filter"><button className={platforms.length?'active':''} onClick={() => setPlatformMenu(!platformMenu)}><Filter size={14}/>Платформы{platforms.length?` (${platforms.length})`:''}<ChevronDown size={14}/></button>{platformMenu && <div className="v36-popover"><strong>Платформы</strong>{platformOptions.map((platform) => <label key={platform}><input type="checkbox" checked={platforms.includes(platform)} onChange={() => setPlatforms((previous) => previous.includes(platform) ? previous.filter((item) => item!==platform) : [...previous,platform])}/>{platform}</label>)}</div>}</div>
      <div className="v36-filter"><button className={accounts.length?'active':''} onClick={() => setAccountMenu(!accountMenu)}><Filter size={14}/>Кабинеты{accounts.length?` (${accounts.length})`:''}<ChevronDown size={14}/></button>{accountMenu && <div className="v36-popover"><strong>Рекламные кабинеты</strong>{accountOptions.map((account) => <label key={account.id}><input type="checkbox" checked={accounts.includes(account.id)} onChange={() => setAccounts((previous) => previous.includes(account.id) ? previous.filter((item) => item!==account.id) : [...previous,account.id])}/><span>{account.name}<small>{account.platform}{account.rawId?` · ${account.rawId}`:''}</small></span></label>)}</div>}</div>
      <div className="v36-filter"><button className={sources.length?'active':''} onClick={() => setSourceMenu(!sourceMenu)}><Filter size={14}/>Источники{sources.length?` (${sources.length})`:''}<ChevronDown size={14}/></button>{sourceMenu && <div className="v36-popover"><strong>Источники лидов</strong>{sourceOptions.map((source) => <label key={source}><input type="checkbox" checked={sources.includes(source)} onChange={() => setSources((previous) => previous.includes(source) ? previous.filter((item) => item!==source) : [...previous,source])}/>{source}</label>)}</div>}</div>
      <div className="v36-filter v36-filter--utm"><button className={utmSource||utmMedium||utmCampaign||utmContent?'active':''} onClick={() => setUtmMenu(!utmMenu)}><SlidersHorizontal size={14}/>UTM фильтры{utmSource||utmMedium||utmCampaign||utmContent?' •':''}<ChevronDown size={14}/></button>{utmMenu && <div className="v36-popover v36-popover--utm"><label><span>UTM Source</span><input value={utmSource} onChange={(event) => setUtmSource(event.target.value)} placeholder="Например: meta"/></label><label><span>UTM Medium</span><input value={utmMedium} onChange={(event) => setUtmMedium(event.target.value)} placeholder="Например: cpc"/></label><label><span>UTM Campaign / ID</span><input value={utmCampaign} onChange={(event) => setUtmCampaign(event.target.value)} placeholder="Название или ID кампании"/></label><label><span>UTM Content</span><input value={utmContent} onChange={(event) => setUtmContent(event.target.value)} placeholder="Креатив или объявление"/></label></div>}</div>
      {activeFilters > 0 && <button className="v36-reset" onClick={clearFilters}><X size={13}/>Сбросить ({activeFilters})</button>}<span>{data.period.from||'—'} — {data.period.to||'—'}</span><button className="v36-sync" onClick={() => void load()} disabled={loading}><RefreshCw className={loading?'spin':''} size={14}/>Обновить</button>
    </section>
    {activeFilters > 0 && <section className="v36-filter-summary"><strong>Фильтр применён</strong><span>Показано {matchingCampaigns.length} из {campaigns.length} кампаний. KPI и диаграммы платформ пересчитаны.</span></section>}
    {error && <div className="v36-error">{error}</div>}
    <section className="v36-kpis">{[['Всего лидов',num(totals.leads),'Лиды CRM','blue'],['Целевые лиды',num(totals.target_leads),`${pct(totals.target_leads,totals.leads)} от всех`,'cyan'],['Пришли',num(totals.arrived),`${pct(totals.arrived,totals.appointments||totals.target_leads)} от записанных`,'purple'],['Продажи',num(totals.sales),`${pct(totals.sales,totals.arrived)} от пришедших`,'green'],['Выручка',money(totals.revenue),`Средний чек ${money(totals.sales?totals.revenue/totals.sales:0)}`,'amber'],['Расход',totals.spendCurrency==='MIXED'?'Разные валюты':moneyIn(totals.spend,totals.spendCurrency||'KZT'),totals.spendCurrency==='MIXED'?'Кабинеты в разных валютах':`Все выбранные кабинеты, ${totals.spendCurrency||'KZT'}`,'violet'],['Неатрибутированные',activeFilters?'—':`${data.attribution.unattributed_rate.toFixed(1)}%`,activeFilters?'Показатель только для общего периода':`${num(data.attribution.unattributed_leads)} лидов`,'red']].map(([title,value,subtitle,tone]) => <article className={`v36-kpi tone-${tone}`} key={title}><i/><strong>{value}</strong><span>{title}</span><small>{subtitle}</small></article>)}</section>
    {!activeFilters && <section className="v36-card"><header><div><h2>Динамика лидов</h2><p>Общая динамика за период; расходы в исходной валюте дневного агрегата</p></div></header><div className="v36-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="label" stroke="#64748b"/><YAxis yAxisId="l" stroke="#64748b"/><YAxis yAxisId="r" orientation="right" stroke="#64748b"/><Tooltip contentStyle={{background:'#060c1c',border:'1px solid #1e2d4a'}}/><Bar yAxisId="r" dataKey="spend" name="Расход" fill="#1e3a5f"/><Line yAxisId="l" dataKey="leads" name="Лиды" stroke="#2563eb" strokeWidth={3}/><Line yAxisId="l" dataKey="sales" name="Продажи" stroke="#22c55e" strokeWidth={3}/></ComposedChart></ResponsiveContainer></div></section>}
    <section className="v36-summary"><article className="v36-card"><h2>Распределение по платформам</h2><div className="v36-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={visiblePlatforms} dataKey="leads" nameKey="platform" innerRadius={52} outerRadius={78}>{visiblePlatforms.map((platform,index) => <Cell key={platform.key} fill={colors[index%colors.length]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer></div>{visiblePlatforms.map((platform,index) => <p className="v36-source" key={platform.key}><i style={{background:colors[index%colors.length]}}/><b>{platform.platform}</b><strong>{num(platform.leads)}</strong><span>{pct(platform.leads,totals.leads)}</span></p>)}</article><article className="v36-card"><h2>Расход по платформам</h2>{visiblePlatforms.map((platform,index) => <div className="v36-bar" key={platform.key}><p><b>{platform.platform}</b><span>{moneyIn(platform.spend,platform.spendCurrency||'KZT')}</span></p><i><em style={{width:`${totals.spend?Math.max(2,platform.spend/totals.spend*100):0}%`,background:colors[index%colors.length]}}/></i></div>)}</article><article className="v36-card"><h2>Воронка по платформам</h2>{visiblePlatforms.map((platform,index) => <div className="v36-bar" key={platform.key}><p><b>{platform.platform}</b><span>{num(platform.sales)} / {num(platform.leads)} · {Math.round(platform.sale_rate)}%</span></p><i><em style={{width:`${Math.max(2,platform.sale_rate)}%`,background:colors[index%colors.length]}}/></i></div>)}</article></section>
    <section className="v36-card v36-table-card"><header><div><h2>Сквозная аналитика по всем кабинетам</h2><p>Платформа → кабинет → кампания → группа объявлений → объявление. * Охват и частота являются приблизительными при суммировании нескольких объектов.</p></div><div className="v36-table-actions"><button type="button" onClick={() => setAllOpen(true)}>Развернуть все</button><button type="button" onClick={() => setAllOpen(false)}>Свернуть все</button><div className="v36-mode"><button className={mode==='ads'?'active':''} onClick={() => setMode('ads')}>Реклама</button><button className={mode==='crm'?'active':''} onClick={() => setMode('crm')}>CRM-воронка</button></div></div></header><div className="v36-table"><table><thead>{mode==='ads'?<tr><th>Структура рекламы</th><th>UTM source</th><th>UTM medium</th><th>UTM campaign</th><th>UTM content</th><th>ROAS</th><th>ROMI</th><th>Расход, KZT</th><th>Выручка, KZT</th><th>Показы</th><th>Охват*</th><th>Клики</th><th>CTR</th><th>CPC, KZT</th><th>CPM, KZT</th><th>Частота*</th><th>Рекомендация</th></tr>:<tr><th>Структура рекламы</th><th>Лиды рекламы</th><th>Лиды CRM</th><th>Целевые</th><th>Записи</th><th>Пришли</th><th>Продажи</th><th>Лид→целевой</th><th>Целевой→запись</th><th>Запись→приход</th><th>Приход→продажа</th><th>CPL, KZT</th><th>Цена целевого</th><th>Цена записи</th><th>Цена прихода</th><th>CAC, KZT</th><th>Выручка</th></tr>}</thead><tbody>{(children.get(null)||[]).map(renderRow)}</tbody></table></div></section>
    {!activeFilters && <section className="v36-heat-sections"><article className="v36-card"><header><div><h2>Конверсия по часам создания лида</h2><p>Фактическая доля записей по часу первого обращения</p></div></header><div className="v36-heat-grid v36-heat-grid--hours">{data.hourly.map((row) => <div className={heatClass(row.rate)} key={row.hour}><strong>{String(row.hour).padStart(2,'0')}:00</strong><b>{row.rate.toFixed(1)}%</b><span>{num(row.leads)} лидов · {num(row.appointments)} записей</span></div>)}</div></article><article className="v36-card"><header><div><h2>Конверсия по дням недели</h2><p>Записи относительно дня создания лида</p></div></header><div className="v36-heat-grid v36-heat-grid--week">{data.weekdays.map((row) => <div className={heatClass(row.rate)} key={row.day}><strong>{week[row.day]||week[row.day-1]||row.day}</strong><b>{row.rate.toFixed(1)}%</b><span>{num(row.appointments)} записей</span></div>)}</div></article><article className="v36-card"><header><div><h2>Дни с момента создания лида</h2><p>Когда лиды фактически записываются</p></div></header><div className="v36-heat-grid v36-heat-grid--delays">{data.delays.map((row) => <div className={heatClass(row.rate)} key={row.day}><strong>День {row.day}</strong><b>{row.rate.toFixed(1)}%</b><span>{num(row.appointments)} записей</span></div>)}</div></article></section>}
  </main>;
}
