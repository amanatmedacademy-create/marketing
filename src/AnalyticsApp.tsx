import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Cable, ChevronDown, ChevronRight, RefreshCw, Settings2, SlidersHorizontal } from 'lucide-react';
import IntegrationManager from './components/IntegrationManager';

interface Totals { leads:number; target_leads:number; arrived:number; sales:number; spend:number; revenue:number }
interface DailyRow { date:string; leads:number; target_leads:number; arrived:number; sales:number; spend:number; revenue:number }
interface PlatformRow { platform:string; campaigns:number; spend:number; revenue:number; leads:number; target_leads:number; arrived:number; sales:number; impressions:number; roas:number; sale_rate:number }
interface CampaignRow {
  key:string; platform:string; source:string; campaign_id:string; campaign_name:string; utm_source:string; utm_medium:string; utm_campaign:string;
  spend:number; revenue:number; impressions:number; reach:number; clicks:number; link_clicks:number; ads_leads:number; crm_leads:number;
  target_leads:number; in_work:number; rejected:number; appointments:number; arrived:number; deals_in_work:number; deals_rejected:number; sales:number;
  active_days:number; roas:number; cpl:number; cpm:number; ctr:number; link_ctr:number; frequency:number; recommendation:string;
}
interface HeatRow { hour?:number; day:number; leads?:number; appointments:number; rate:number }
interface AnalyticsResponse {
  period:{from:string;to:string;days:number}; totals:Totals; daily:DailyRow[]; platforms:PlatformRow[]; campaigns:CampaignRow[];
  hourly:Array<{hour:number;leads:number;appointments:number;rate:number}>; weekdays:HeatRow[]; delays:HeatRow[];
  attribution:{total_leads:number;unattributed_leads:number;unattributed_rate:number}; settings:Record<string,unknown>;
}

const EMPTY: AnalyticsResponse = {
  period:{from:'',to:'',days:7}, totals:{leads:0,target_leads:0,arrived:0,sales:0,spend:0,revenue:0}, daily:[], platforms:[], campaigns:[],
  hourly:Array.from({length:24},(_,hour)=>({hour,leads:0,appointments:0,rate:0})), weekdays:Array.from({length:7},(_,day)=>({day,appointments:0,rate:0})),
  delays:Array.from({length:7},(_,index)=>({day:index+1,appointments:0,rate:0})), attribution:{total_leads:0,unattributed_leads:0,unattributed_rate:0}, settings:{}
};

const money = (value:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(Number(value||0));
const number = (value:number) => new Intl.NumberFormat('ru-RU').format(Number(value||0));
const pct = (value:number,total:number) => total ? `${(value*100/total).toFixed(0)}%` : '0%';
const metricPct = (value:number) => `${Number(value||0).toFixed(1)}%`;
const platformClass = (platform:string) => `platform-${platform.toLowerCase().replace(/[^a-zа-я0-9]+/g,'-')}`;
const weekNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function recommendationClass(value:string) {
  if (value === 'Масштабировать') return 'recommendation recommendation--scale';
  if (value === 'Растить') return 'recommendation recommendation--grow';
  if (value === 'Наблюдать') return 'recommendation recommendation--watch';
  if (value === 'Отключить') return 'recommendation recommendation--stop';
  return 'recommendation';
}

function heatClass(rate:number) {
  if (rate >= 45) return 'heat heat--5';
  if (rate >= 35) return 'heat heat--4';
  if (rate >= 25) return 'heat heat--3';
  if (rate >= 15) return 'heat heat--2';
  if (rate > 0) return 'heat heat--1';
  return 'heat';
}

function Kpi({label,value,detail,accent}:{label:string;value:string;detail:string;accent?:string}) {
  return <article className={`analytics-kpi ${accent||''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AnalyticsDashboard() {
  const [days,setDays] = useState(7);
  const [data,setData] = useState<AnalyticsResponse>(EMPTY);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const [mode,setMode] = useState<'ads'|'crm'>('ads');
  const [expanded,setExpanded] = useState<Record<string,boolean>>({});

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/analytics/overview?days=${days}`);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
      setData(JSON.parse(body) as AnalyticsResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setData(EMPTY);
    } finally { setLoading(false); }
  };

  useEffect(()=>{ load(); },[days]);

  const grouped = useMemo(()=>data.platforms.map(platform=>({
    platform,
    campaigns:data.campaigns.filter(row=>row.platform===platform.platform),
  })),[data]);

  const chart = data.daily.map(row=>({...row,label:new Date(`${row.date}T00:00:00`).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}));
  const t = data.totals;

  return <div className="analytics-page">
    <header className="analytics-header">
      <div><span>AMANAT MED</span><h1>Рекламная аналитика</h1></div>
      <nav><NavLink to="/">Аналитика</NavLink><NavLink to="/integrations"><Cable size={16}/>Интеграции</NavLink></nav>
      <button onClick={load} disabled={loading}><RefreshCw className={loading?'spin':''} size={16}/>Синхронизировать</button>
    </header>

    <main className="analytics-content">
      <section className="analytics-toolbar">
        <div className="period-buttons">{[3,7,15,30].map(value=><button key={value} className={days===value?'active':''} onClick={()=>setDays(value)}>{value} {value===3?'дня':'дней'}</button>)}</div>
        <button><SlidersHorizontal size={15}/>Источники</button><button><SlidersHorizontal size={15}/>Направление</button><button><SlidersHorizontal size={15}/>UTM фильтры</button>
        <span>{data.period.from || '—'} — {data.period.to || '—'}</span>
      </section>

      {error && <div className="analytics-error">{error}</div>}

      <section className="analytics-kpis">
        <Kpi label="Всего лидов" value={number(t.leads)} detail="Лиды CRM за период" accent="kpi-blue"/>
        <Kpi label="Целевые лиды" value={number(t.target_leads)} detail={`${pct(t.target_leads,t.leads)} от всех`} accent="kpi-cyan"/>
        <Kpi label="Пришли на визит" value={number(t.arrived)} detail={`${pct(t.arrived,t.target_leads)} от целевых`} accent="kpi-purple"/>
        <Kpi label="Продажи" value={number(t.sales)} detail={`${pct(t.sales,t.arrived)} от пришедших`} accent="kpi-green"/>
        <Kpi label="Выручка" value={money(t.revenue)} detail={`Средний чек ${money(t.sales?t.revenue/t.sales:0)}`} accent="kpi-amber"/>
        <Kpi label="Общий расход" value={money(t.spend)} detail={`ROAS ${t.spend?(t.revenue/t.spend).toFixed(1):'0'}x`} accent="kpi-violet"/>
        <Kpi label="Неатрибутированные" value={metricPct(data.attribution.unattributed_rate)} detail={`${number(data.attribution.unattributed_leads)} лидов`} accent="kpi-red"/>
      </section>

      <section className="analytics-panel">
        <header><div><h2>Динамика лидов</h2><p>Лиды, продажи и рекламный расход</p></div></header>
        <div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><CartesianGrid stroke="#1f304d" vertical={false}/><XAxis dataKey="label" stroke="#71809c"/><YAxis stroke="#71809c"/><Tooltip contentStyle={{background:'#081426',border:'1px solid #203454'}}/><Area type="monotone" dataKey="leads" stroke="#2f7cff" fill="#2f7cff33"/><Area type="monotone" dataKey="sales" stroke="#21d47b" fill="#21d47b22"/></AreaChart></ResponsiveContainer></div>
      </section>

      <section className="analytics-summary-grid">
        <article className="analytics-panel"><h2>Распределение по источникам</h2><div className="platform-list">{data.platforms.map(row=><div key={row.platform}><span className={`platform-dot ${platformClass(row.platform)}`}/><b>{row.platform}</b><strong>{number(row.leads)}</strong><small>{pct(row.leads,t.leads)}</small></div>)}</div></article>
        <article className="analytics-panel"><h2>Расход и ROAS по платформам</h2><div className="platform-bars">{data.platforms.map(row=><div key={row.platform}><header><b>{row.platform}</b><span>{money(row.spend)} · ROAS {row.roas.toFixed(1)}x</span></header><i><em style={{width:`${t.spend?Math.max(2,row.spend/t.spend*100):0}%`}}/></i></div>)}</div></article>
        <article className="analytics-panel"><h2>Воронка по платформам</h2><div className="platform-bars">{data.platforms.map(row=><div key={row.platform}><header><b>{row.platform}</b><span>{number(row.leads)} лидов · {number(row.sales)} продаж</span></header><i><em style={{width:`${Math.max(2,row.sale_rate)}%`}}/></i></div>)}</div></article>
      </section>

      <section className="analytics-panel campaign-panel">
        <header className="campaign-header"><div><h2>Детализация по кампаниям</h2><p>{data.campaigns.length} кампаний</p></div><div className="mode-switch"><button className={mode==='ads'?'active':''} onClick={()=>setMode('ads')}>Реклама</button><button className={mode==='crm'?'active':''} onClick={()=>setMode('crm')}>CRM-воронка</button></div></header>
        <div className="campaign-table-wrap"><table className="campaign-table"><thead>{mode==='ads'?<tr><th>Источник</th><th>UTM source</th><th>UTM medium</th><th>UTM campaign</th><th>Рекомендация</th><th>ROAS</th><th>Расход</th><th>Выручка</th><th>Показы</th><th>Частота</th><th>CTR</th><th>CTR ссылки</th><th>CPM</th></tr>:<tr><th>Источник</th><th>Цена лида</th><th>Лиды Bitrix</th><th>Целевые</th><th>В работе</th><th>Брак</th><th>Записаны</th><th>Пришли</th><th>Сделки в работе</th><th>Сделки брак</th><th>Купили</th><th>Рекомендация</th></tr>}</thead><tbody>
          <tr className="total-row"><td>Итого</td>{mode==='ads'?<><td/><td/><td/><td/><td>{t.spend?(t.revenue/t.spend).toFixed(1):'0'}x</td><td>{money(t.spend)}</td><td>{money(t.revenue)}</td><td>{number(data.campaigns.reduce((s,r)=>s+r.impressions,0))}</td><td/><td/><td/><td/></>:<><td>{money(t.leads?t.spend/t.leads:0)}</td><td>{number(t.leads)}</td><td>{number(t.target_leads)} ({pct(t.target_leads,t.leads)})</td><td>{number(data.campaigns.reduce((s,r)=>s+r.in_work,0))}</td><td>{number(data.campaigns.reduce((s,r)=>s+r.rejected,0))}</td><td>{number(data.campaigns.reduce((s,r)=>s+r.appointments,0))}</td><td>{number(t.arrived)}</td><td>{number(data.campaigns.reduce((s,r)=>s+r.deals_in_work,0))}</td><td>{number(data.campaigns.reduce((s,r)=>s+r.deals_rejected,0))}</td><td>{number(t.sales)}</td><td/></>}</tr>
          {grouped.map(group=><>{<tr key={group.platform.platform} className={`platform-row ${platformClass(group.platform.platform)}`} onClick={()=>setExpanded(previous=>({...previous,[group.platform.platform]:!previous[group.platform.platform]}))}><td><span className="expand-icon">{expanded[group.platform.platform]?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</span><b>{group.platform.platform}</b><small>{group.platform.campaigns} кампаний</small></td>{mode==='ads'?<><td/><td/><td/><td/><td>{group.platform.roas.toFixed(1)}x</td><td>{money(group.platform.spend)}</td><td>{money(group.platform.revenue)}</td><td>{number(group.platform.impressions)}</td><td/><td/><td/><td/></>:<><td>{money(group.platform.leads?group.platform.spend/group.platform.leads:0)}</td><td>{number(group.platform.leads)}</td><td>{number(group.platform.target_leads)} ({pct(group.platform.target_leads,group.platform.leads)})</td><td/><td/><td/><td>{number(group.platform.arrived)}</td><td/><td/><td>{number(group.platform.sales)}</td><td/></>}</tr>}
            {expanded[group.platform.platform]&&group.campaigns.map(row=><tr key={row.key} className="campaign-row"><td><b>{row.campaign_name}</b><small>{row.campaign_id||row.source}</small></td>{mode==='ads'?<><td>{row.utm_source||'—'}</td><td>{row.utm_medium||'—'}</td><td>{row.utm_campaign||'—'}</td><td><span className={recommendationClass(row.recommendation)}>{row.recommendation}</span></td><td>{row.roas.toFixed(1)}x</td><td>{money(row.spend)}</td><td>{money(row.revenue)}</td><td>{number(row.impressions)}</td><td>{row.frequency.toFixed(1)}</td><td>{metricPct(row.ctr)}</td><td>{metricPct(row.link_ctr)}</td><td>{money(row.cpm)}</td></>:<><td>{money(row.cpl)}</td><td>{number(row.crm_leads)}</td><td>{number(row.target_leads)} ({pct(row.target_leads,row.crm_leads)})</td><td>{number(row.in_work)}</td><td>{number(row.rejected)}</td><td>{number(row.appointments)}</td><td>{number(row.arrived)}</td><td>{number(row.deals_in_work)}</td><td>{number(row.deals_rejected)}</td><td>{number(row.sales)}</td><td><span className={recommendationClass(row.recommendation)}>{row.recommendation}</span></td></>}</tr>)}
          </>)}</tbody></table></div>
      </section>

      <section className="analytics-panel"><header><div><h2>Конверсия в запись по часам создания лида</h2><p>Процент лидов, дошедших до записи</p></div></header><div className="heat-table"><div className="heat-label">Все источники</div>{data.hourly.map(row=><div key={row.hour} className={heatClass(row.rate)}><small>{String(row.hour).padStart(2,'0')}:00</small><b>{metricPct(row.rate)}</b></div>)}</div></section>
      <section className="analytics-panel"><header><div><h2>Конверсия по дням недели и сроку записи</h2><p>Когда создаются и когда записываются лиды</p></div></header><div className="dual-heat"><div><h3>По дням недели</h3><div className="heat-table heat-table--seven">{data.weekdays.map(row=><div key={row.day} className={heatClass(row.rate)}><small>{weekNames[row.day]}</small><b>{metricPct(row.rate)}</b><em>{number(row.appointments)} записей</em></div>)}</div></div><div><h3>Дней с момента создания</h3><div className="heat-table heat-table--seven">{data.delays.map(row=><div key={row.day} className={heatClass(row.rate)}><small>День {row.day}</small><b>{metricPct(row.rate)}</b><em>{number(row.appointments)} записей</em></div>)}</div></div></div></section>
    </main>
  </div>;
}

function AnalyticsShell(){return <Routes><Route path="/" element={<AnalyticsDashboard/>}/><Route path="/integrations" element={<div className="integration-page"><header className="analytics-header"><div><span>AMANAT MED</span><h1>Интеграции</h1></div><nav><NavLink to="/"><BarChart3 size={16}/>Аналитика</NavLink><NavLink to="/integrations"><Cable size={16}/>Интеграции</NavLink></nav></header><main className="analytics-content"><IntegrationManager/></main></div>}/><Route path="*" element={<AnalyticsDashboard/>}/></Routes>}

export default function AnalyticsApp(){return <BrowserRouter><AnalyticsShell/></BrowserRouter>}
