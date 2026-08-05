import { useEffect, useMemo, useState } from 'react';
import { Activity, Eye, MousePointerClick, Target, TrendingUp, Users } from 'lucide-react';

interface CampaignRow {
  impressions:number; reach:number; clicks:number; link_clicks:number; spend:number; revenue:number;
  ads_leads:number; crm_leads:number; target_leads:number; sales:number;
}
interface AnalyticsResponse {
  period:{from:string;to:string;days:number};
  totals:{leads:number;target_leads:number;arrived:number;sales:number;spend:number;revenue:number};
  campaigns:CampaignRow[];
}

const money = (value:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(Number(value||0));
const number = (value:number) => new Intl.NumberFormat('ru-RU').format(Number(value||0));
const pct = (value:number) => `${Number(value||0).toFixed(2)}%`;

export default function ExtendedDashboardMetrics() {
  const dashboard = (window.location.pathname.replace(/\/+$/,'') || '/') === '/';
  const [data,setData] = useState<AnalyticsResponse|null>(null);
  const [days,setDays] = useState(30);

  useEffect(()=>{
    if (!dashboard) return;
    let cancelled = false;
    fetch(`/api/analytics/overview?days=${days}`)
      .then(async response => {
        const body = await response.text();
        if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
        return JSON.parse(body) as AnalyticsResponse;
      })
      .then(result => { if (!cancelled) setData(result); })
      .catch(()=>{ if (!cancelled) setData(null); });
    return ()=>{ cancelled = true; };
  },[dashboard,days]);

  const metrics = useMemo(()=>{
    const campaigns = data?.campaigns || [];
    const impressions = campaigns.reduce((s,r)=>s+Number(r.impressions||0),0);
    const reach = campaigns.reduce((s,r)=>s+Number(r.reach||0),0);
    const clicks = campaigns.reduce((s,r)=>s+Number(r.clicks||0),0);
    const linkClicks = campaigns.reduce((s,r)=>s+Number(r.link_clicks||0),0);
    const adsLeads = campaigns.reduce((s,r)=>s+Number(r.ads_leads||0),0);
    const spend = Number(data?.totals.spend||0);
    const sales = Number(data?.totals.sales||0);
    return {
      impressions,reach,clicks,linkClicks,adsLeads,spend,sales,
      frequency: reach ? impressions/reach : 0,
      ctrAll: impressions ? clicks*100/impressions : 0,
      ctrLink: impressions ? linkClicks*100/impressions : 0,
      cpm: impressions ? spend*1000/impressions : 0,
      cpc: clicks ? spend/clicks : 0,
      cplAds: adsLeads ? spend/adsLeads : 0,
      cplCrm: data?.totals.leads ? spend/data.totals.leads : 0,
      costPerSale: sales ? spend/sales : 0,
      roas: spend ? Number(data?.totals.revenue||0)/spend : 0,
    };
  },[data]);

  if (!dashboard) return null;

  const cards = [
    {label:'Показы',value:number(metrics.impressions),detail:'Всего рекламных показов',icon:<Eye size={17}/>},
    {label:'Охват',value:number(metrics.reach),detail:'Уникальные пользователи',icon:<Users size={17}/>},
    {label:'Частота',value:metrics.frequency.toFixed(2),detail:'Показов на пользователя',icon:<Activity size={17}/>},
    {label:'Клики',value:number(metrics.clicks),detail:`По ссылке: ${number(metrics.linkClicks)}`,icon:<MousePointerClick size={17}/>},
    {label:'CTR общий',value:pct(metrics.ctrAll),detail:`CTR ссылки: ${pct(metrics.ctrLink)}`,icon:<TrendingUp size={17}/>},
    {label:'CPM',value:money(metrics.cpm),detail:`CPC: ${money(metrics.cpc)}`,icon:<Target size={17}/>},
    {label:'Лиды Meta',value:number(metrics.adsLeads),detail:`Цена лида: ${money(metrics.cplAds)}`,icon:<Users size={17}/>},
    {label:'Лиды CRM',value:number(data?.totals.leads||0),detail:`Цена лида: ${money(metrics.cplCrm)}`,icon:<Users size={17}/>},
    {label:'Продажи',value:number(metrics.sales),detail:`Цена продажи: ${money(metrics.costPerSale)}`,icon:<Target size={17}/>},
    {label:'ROAS',value:`${metrics.roas.toFixed(2)}x`,detail:`Выручка: ${money(data?.totals.revenue||0)}`,icon:<TrendingUp size={17}/>},
  ];

  return <section className="imds-metrics-block">
    <header className="imds-metrics-head">
      <div><span>Полная рекламная статистика</span><h2>Метрики рекламных кабинетов</h2><p>Показатели из Meta Ads и CRM в одном срезе.</p></div>
      <div className="imds-periods">{[7,30,90].map(value=><button key={value} className={days===value?'active':''} onClick={()=>setDays(value)}>{value} дней</button>)}</div>
    </header>
    <div className="imds-metrics-grid">
      {cards.map(card=><article key={card.label}><div className="imds-metric-icon">{card.icon}</div><span>{card.label}</span><strong>{card.value}</strong><small>{card.detail}</small></article>)}
    </div>
  </section>;
}
