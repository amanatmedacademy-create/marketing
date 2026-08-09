import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BrainCircuit, GitCompareArrows, SlidersHorizontal } from 'lucide-react';
import DataInspector from './DataInspector';

interface Totals { leads:number; target_leads:number; arrived:number; sales:number; spend:number; revenue:number }
interface DailyRow { date:string; leads:number; target_leads:number; arrived:number; sales:number; spend:number; revenue:number }
interface PlatformRow { platform:string; campaigns:number; spend:number; revenue:number; leads:number; target_leads:number; arrived:number; sales:number; impressions:number; roas:number; sale_rate:number }
interface AnalyticsResponse {
  period:{from:string;to:string;days:number}; totals:Totals; daily:DailyRow[]; platforms:PlatformRow[];
  attribution:{total_leads:number;unattributed_leads:number;unattributed_rate:number};
}

type InspectorSpec = { description:string; sources:string[]; fields:string[]; formula?:string; example?:string[]; technical?:string[] };

const EMPTY:AnalyticsResponse={period:{from:'',to:'',days:7},totals:{leads:0,target_leads:0,arrived:0,sales:0,spend:0,revenue:0},daily:[],platforms:[],attribution:{total_leads:0,unattributed_leads:0,unattributed_rate:0}};
const money=(value:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(Number(value||0));
const number=(value:number)=>new Intl.NumberFormat('ru-RU').format(Number(value||0));
const pct=(value:number,total:number)=>total?`${Math.round(value*100/total)}%`:'0%';
const palette=['#2f7cff','#ff1654','#ff5a1f','#1797ff','#26c66c','#13c889','#8b5cf6'];

const KPI_INFO:Record<string,InspectorSpec>={
  'Всего лидов':{description:'Количество CRM-лидов, созданных за выбранный период для текущей клиники.',sources:['IMDS CRM','WhatsApp','Instagram','Telegram','Lead Ads'],fields:['lead_id','lead_created_at','source','platform','utm_source'],formula:'Количество уникальных lead_id за выбранный период',example:['168 входящих обращений','− 14 дублей','− 7 тестовых','= 147 уникальных лидов'],technical:['Metric: totals.leads','Endpoint: /api/analytics/overview']},
  'Целевые лиды':{description:'Лиды, которые прошли квалификацию и отмечены как целевые.',sources:['IMDS CRM'],fields:['lead_id','is_target','stage'],formula:'Целевые лиды / Все лиды × 100%',example:['147 лидов','81 целевой','= 55% целевых'],technical:['Metric: totals.target_leads']},
  'Пришли на визит':{description:'Лиды с подтверждённым фактом прихода в клинику.',sources:['IMDS CRM','МИС/CRM при подключении'],fields:['lead_id','arrived_at','appointment_at','stage'],formula:'Пришедшие / записанные или целевые × 100%',example:['60 записей','42 прихода','= 70%'],technical:['Metric: totals.arrived']},
  'Продажи':{description:'Количество лидов, которые завершились продажей.',sources:['IMDS CRM','CRM продаж'],fields:['lead_id','sold_at','sale_amount','deal_id'],formula:'Продажи / Пришедшие × 100%',example:['42 прихода','18 продаж','= 43%'],technical:['Metric: totals.sales']},
  'Выручка':{description:'Сумма выручки по продажам, связанным с лидами выбранного периода.',sources:['IMDS CRM','CRM продаж'],fields:['sale_amount','sold_at','lead_id'],formula:'Σ sale_amount',example:['Продажа 1 — 120 000 ₸','Продажа 2 — 85 000 ₸','= 205 000 ₸'],technical:['Metric: totals.revenue','Currency: KZT']},
  'Общий расход':{description:'Рекламные расходы всех доступных рекламных кабинетов за выбранный период.',sources:['Meta Marketing API','TikTok Ads API'],fields:['spend','account_id','campaign_id','date'],formula:'Σ рекламных расходов после нормализации валюты',example:['Meta — 320 000 ₸','TikTok — 165 000 ₸','= 485 000 ₸'],technical:['Metric: totals.spend','Currency: KZT']},
  'Неатрибутированные':{description:'Доля CRM-лидов, которым IMDS не смог уверенно сопоставить рекламный источник.',sources:['IMDS CRM','UTM','Meta/TikTok attribution'],fields:['lead_id','source','utm_source','utm_campaign','campaign_id'],formula:'Неатрибутированные лиды / Все лиды × 100%',example:['147 лидов','12 без источника','= 8.2% неатрибутированных'],technical:['Metric: attribution.unattributed_rate']},
};

export default function DashboardV36Overview(){
  const isDashboard=(window.location.pathname.replace(/\/+$/,'')||'/')==='/';
  const [target,setTarget]=useState<Element|null>(null);
  const [days,setDays]=useState(7);
  const [data,setData]=useState<AnalyticsResponse>(EMPTY);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    if(!isDashboard)return;
    const mount=document.createElement('div');
    mount.className='dashboard-v36-mount';
    const content=document.querySelector('.analytics-content');
    if(content){content.prepend(mount);setTarget(mount);document.body.classList.add('dashboard-v36-active');}
    return()=>{document.body.classList.remove('dashboard-v36-active');mount.remove();};
  },[isDashboard]);

  useEffect(()=>{
    if(!isDashboard)return;
    let cancelled=false;setLoading(true);
    fetch(`/api/analytics/overview?days=${days}`).then(async response=>{
      const body=await response.text();if(!response.ok)throw new Error(body||`HTTP ${response.status}`);return JSON.parse(body) as AnalyticsResponse;
    }).then(result=>{if(!cancelled)setData(result);}).catch(()=>{if(!cancelled)setData(EMPTY);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[days,isDashboard]);

  const chart=data.daily.map(row=>({...row,label:new Date(`${row.date}T00:00:00`).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}));
  const maxSpend=Math.max(1,...data.platforms.map(row=>row.spend));
  const t=data.totals;
  const kpis=useMemo(()=>[
    {label:'Всего лидов',value:number(t.leads),detail:'Лиды CRM за период',tone:'blue'},
    {label:'Целевые лиды',value:number(t.target_leads),detail:`${pct(t.target_leads,t.leads)} от всех`,tone:'cyan'},
    {label:'Пришли на визит',value:number(t.arrived),detail:`${pct(t.arrived,t.target_leads)} от целевых`,tone:'purple'},
    {label:'Продажи',value:number(t.sales),detail:`${pct(t.sales,t.arrived)} от пришедших`,tone:'green'},
    {label:'Выручка',value:money(t.revenue),detail:`Средний чек ${money(t.sales?t.revenue/t.sales:0)}`,tone:'amber'},
    {label:'Общий расход',value:money(t.spend),detail:`ROAS ${t.spend?(t.revenue/t.spend).toFixed(1):'0'}x`,tone:'violet'},
    {label:'Неатрибутированные',value:`${Number(data.attribution.unattributed_rate||0).toFixed(1)}%`,detail:`${number(data.attribution.unattributed_leads)} лидов`,tone:'red'},
  ],[t,data.attribution]);

  const periodFilters=['Текущая клиника',`${data.period.from||'—'} — ${data.period.to||'—'}`,`${days} дней`];
  const inspectorQuality=loading?'delayed':'fresh' as const;

  if(!isDashboard||!target)return null;
  return createPortal(<div className="dashboard-v36">
    <section className="dashboard-v36-toolbar">
      <div className="dashboard-v36-periods">{[3,7,15,30].map(value=><button key={value} className={days===value?'active':''} onClick={()=>setDays(value)}>{value} {value===3?'дня':'дней'}</button>)}</div>
      <button><GitCompareArrows size={15}/>Сравнить с прошлым периодом</button>
      <button><SlidersHorizontal size={15}/>Источники</button>
      <button><SlidersHorizontal size={15}/>Направление</button>
      <button><SlidersHorizontal size={15}/>UTM фильтры</button>
      <button className="dashboard-v36-ai"><BrainCircuit size={16}/>Анализ креативов</button>
      <span>{loading?'Обновление…':`${data.period.from||'—'} — ${data.period.to||'—'}`}</span>
    </section>

    <section className="dashboard-v36-kpis">{kpis.map(item=>{const info=KPI_INFO[item.label];return <article key={item.label} className={`tone-${item.tone}`}><i/><strong>{item.value}</strong><span className="data-inspector-kpi-head">{item.label}<DataInspector compact title={item.label} description={info.description} sources={info.sources} fields={info.fields} formula={info.formula} example={info.example} filters={periodFilters} quality={inspectorQuality} qualityNote={loading?'Идёт обновление аналитики':'Данные получены для текущего периода'} technical={info.technical}/></span><small>{item.detail}</small></article>})}</section>

    <section className="dashboard-v36-panel dashboard-v36-dynamics">
      <header><div><h2 className="data-inspector-card-title">Динамика лидов<DataInspector compact title="Динамика лидов" description="Показывает изменение количества лидов, продаж и рекламных расходов по дням." sources={['IMDS CRM','Meta Marketing API','TikTok Ads API']} fields={['date','leads','sales','spend']} filters={periodFilters} quality={inspectorQuality} technical={['Dataset: daily','Endpoint: /api/analytics/overview']}/></h2><p>Лиды, WON и рекламный расход</p></div><div className="dashboard-v36-legend"><span className="lead">Лиды</span><span className="won">WON</span><span className="spend">Расход</span></div></header>
      <div className="dashboard-v36-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart}><CartesianGrid stroke="#1f304d" vertical={false}/><XAxis dataKey="label" stroke="#64748b"/><YAxis yAxisId="left" stroke="#64748b"/><YAxis yAxisId="right" orientation="right" stroke="#64748b"/><Tooltip contentStyle={{background:'#081426',border:'1px solid #203454'}} formatter={(value:number,name:string)=>name==='spend'?money(value):number(value)}/><Bar yAxisId="right" dataKey="spend" fill="#17345f" radius={[4,4,0,0]}/><Line yAxisId="left" type="monotone" dataKey="leads" stroke="#2f7cff" strokeWidth={3} dot={{r:4}}/><Line yAxisId="left" type="monotone" dataKey="sales" stroke="#21d47b" strokeWidth={3} dot={{r:4}}/></ComposedChart></ResponsiveContainer></div>
    </section>

    <section className="dashboard-v36-summary">
      <article className="dashboard-v36-panel source-panel"><h2 className="data-inspector-card-title">Распределение по источникам<DataInspector compact title="Распределение по источникам" description="Показывает, какая доля лидов пришла с каждой рекламной или маркетинговой платформы." sources={['IMDS CRM','UTM/атрибуция']} fields={['platform','source','leads']} formula="Доля источника = лиды источника / все лиды × 100%" filters={periodFilters} quality={inspectorQuality} technical={['Dataset: platforms','Metric: leads']}/></h2><div className="source-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.platforms} dataKey="leads" nameKey="platform" innerRadius={58} outerRadius={88} paddingAngle={2}>{data.platforms.map((row,index)=><Cell key={row.platform} fill={palette[index%palette.length]}/>)}</Pie><Tooltip contentStyle={{background:'#081426',border:'1px solid #203454'}}/></PieChart></ResponsiveContainer><div className="source-total"><strong>{number(t.leads)}</strong><span>лидов</span></div></div><div className="source-list">{data.platforms.map((row,index)=><div key={row.platform}><i style={{background:palette[index%palette.length]}}/><span>{row.platform}</span><strong>{number(row.leads)}</strong><small>{pct(row.leads,t.leads)}</small></div>)}</div></article>
      <article className="dashboard-v36-panel"><h2 className="data-inspector-card-title">Расход и ROAS по платформам<DataInspector compact title="Расход и ROAS по платформам" description="Сравнивает рекламный расход и возврат рекламных инвестиций между платформами." sources={['Meta Marketing API','TikTok Ads API','IMDS CRM']} fields={['platform','spend','revenue','roas']} formula="ROAS = выручка / рекламный расход" filters={periodFilters} quality={inspectorQuality} example={['Расход — 100 000 ₸','Выручка — 380 000 ₸','ROAS = 3.8x']} technical={['Dataset: platforms','ROAS calculated by IMDS']}/></h2><div className="dashboard-v36-bars">{data.platforms.map((row,index)=><div key={row.platform}><header><b><i style={{background:palette[index%palette.length]}}/>{row.platform}</b><span>{money(row.spend)} <em>ROAS {row.roas.toFixed(1)}x</em></span></header><p><i style={{width:`${Math.max(2,row.spend/maxSpend*100)}%`,background:palette[index%palette.length]}}/></p></div>)}</div></article>
      <article className="dashboard-v36-panel"><h2 className="data-inspector-card-title">Воронка по платформам<DataInspector compact title="Воронка по платформам" description="Показывает переход от лидов к продажам отдельно по каждой платформе." sources={['IMDS CRM','Атрибуция источников']} fields={['platform','leads','sales','sale_rate']} formula="Конверсия в продажу = продажи / лиды × 100%" filters={periodFilters} quality={inspectorQuality} technical={['Dataset: platforms','Metric: sale_rate']}/></h2><p className="panel-subtitle">Лиды → WON · конверсия</p><div className="dashboard-v36-funnel">{data.platforms.map((row,index)=><div key={row.platform}><header><b><i style={{background:palette[index%palette.length]}}/>{row.platform}</b><span>{number(row.leads)} лидов <em>{Math.round(row.sale_rate)}% WON</em></span></header><p><i style={{width:`${Math.max(2,row.sale_rate)}%`,background:palette[index%palette.length]}}/></p><small>{number(row.sales)} WON</small></div>)}</div></article>
    </section>
  </div>,target);
}