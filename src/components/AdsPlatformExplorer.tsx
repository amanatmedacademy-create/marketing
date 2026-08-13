import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, ChevronRight, CircleDollarSign, Layers3, LoaderCircle, MousePointerClick, RefreshCw, Search, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { authFetch } from '../services/auth';
import '../ads-platform-explorer.css';

type Level = 'account' | 'campaign' | 'adset' | 'ad';
type AdRow = {
  key:string; account_id:string; account_name:string; campaign_id:string; campaign_name:string; adset_id:string; adset_name:string; ad_id:string; ad_name:string;
  platform:string; source:string; status:string; impressions:number; reach:number; clicks:number; spend:number; leads:number; target_leads:number; arrived:number; sales:number; revenue:number;
};
type AdResponse = { accounts:Array<{id:string;name:string;platform?:string}>; rows:AdRow[] };
type ConversionRow = { id:string; destination?:string; sync_status?:string; event_name?:string; occurred_at?:string; last_error?:string|null };
type Destination = { provider?:string; external_destination_id?:string; enabled?:boolean; updated_at?:string|null };
type Node = { id:string; name:string; platform:string; status:string; spend:number; impressions:number; clicks:number; leads:number; sales:number; revenue:number; children:number };

const num=(value:unknown)=>Number(value||0)||0;
const text=(value:unknown)=>typeof value==='string'?value.trim():value==null?'':String(value).trim();
const money=(value:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(value||0);
const number=(value:number)=>new Intl.NumberFormat('ru-RU').format(value||0);
const label=(level:Level)=>level==='account'?'Кабинеты':level==='campaign'?'Кампании':level==='adset'?'Группы объявлений':'Объявления / креативы';

async function json<T>(path:string):Promise<T>{
  const response=await authFetch(path);
  const body=await response.text();
  let parsed:unknown={};
  try{parsed=body?JSON.parse(body):{};}catch{parsed={error:body};}
  if(!response.ok)throw new Error(text((parsed as Record<string,unknown>).error)||`HTTP ${response.status}`);
  return parsed as T;
}

function aggregate(rows:AdRow[],level:Level,scope:{account?:string;campaign?:string;adset?:string}):Node[]{
  const filtered=rows.filter(row=>(!scope.account||row.account_id===scope.account)&&(!scope.campaign||row.campaign_id===scope.campaign)&&(!scope.adset||row.adset_id===scope.adset));
  const map=new Map<string,Node&{statuses:Set<string>; childSet:Set<string>}>();
  for(const row of filtered){
    const id=level==='account'?row.account_id:level==='campaign'?row.campaign_id:level==='adset'?row.adset_id:row.ad_id;
    if(!id)continue;
    const name=level==='account'?row.account_name:level==='campaign'?row.campaign_name:level==='adset'?row.adset_name:row.ad_name;
    const child=level==='account'?row.campaign_id:level==='campaign'?row.adset_id:level==='adset'?row.ad_id:'';
    const current=map.get(id)||{id,name:name||id,platform:row.platform||row.source||'—',status:'UNKNOWN',spend:0,impressions:0,clicks:0,leads:0,sales:0,revenue:0,children:0,statuses:new Set<string>(),childSet:new Set<string>()};
    current.statuses.add(row.status||'UNKNOWN'); if(child)current.childSet.add(child);
    current.spend+=num(row.spend);current.impressions+=num(row.impressions);current.clicks+=num(row.clicks);current.leads+=num(row.leads);current.sales+=num(row.sales);current.revenue+=num(row.revenue);
    map.set(id,current);
  }
  return [...map.values()].map(({statuses,childSet,...item})=>({...item,status:statuses.size===1?[...statuses][0]:'MIXED',children:childSet.size})).sort((a,b)=>b.spend-a.spend);
}

export default function AdsPlatformExplorer(){
  const [data,setData]=useState<AdResponse>({accounts:[],rows:[]});
  const [conversions,setConversions]=useState<ConversionRow[]>([]);
  const [destinations,setDestinations]=useState<Destination[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [level,setLevel]=useState<Level>('account');
  const [scope,setScope]=useState<{account?:string;campaign?:string;adset?:string}>({});
  const [query,setQuery]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [ads,conversionRows,destinationRows]=await Promise.all([
        json<AdResponse>('/api/analytics/ad-manager?days=30'),
        json<ConversionRow[]>('/api/growth/conversions?limit=500').catch(()=>[]),
        json<Destination[]>('/api/growth/destinations').catch(()=>[]),
      ]);
      setData(ads);setConversions(conversionRows);setDestinations(destinationRows);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);

  const nodes=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    const rows=aggregate(data.rows,level,scope);
    return needle?rows.filter(item=>`${item.name} ${item.id} ${item.platform}`.toLowerCase().includes(needle)):rows;
  },[data,level,scope,query]);

  const health=useMemo(()=>{
    const total=conversions.length;
    const sent=conversions.filter(item=>item.sync_status==='sent').length;
    const failed=conversions.filter(item=>item.sync_status==='failed').length;
    const pending=conversions.filter(item=>['pending','processing'].includes(item.sync_status||'')).length;
    const enabled=destinations.filter(item=>item.enabled).length;
    const rate=total?Math.round(sent*100/total):0;
    return {total,sent,failed,pending,enabled,rate};
  },[conversions,destinations]);

  const drill=(node:Node)=>{
    if(level==='account'){setScope({account:node.id});setLevel('campaign');}
    else if(level==='campaign'){setScope(previous=>({...previous,campaign:node.id}));setLevel('adset');}
    else if(level==='adset'){setScope(previous=>({...previous,adset:node.id}));setLevel('ad');}
  };
  const crumbs=[
    {label:'Кабинеты',level:'account' as Level,scope:{}},
    ...(scope.account?[{label:data.rows.find(row=>row.account_id===scope.account)?.account_name||scope.account,level:'campaign' as Level,scope:{account:scope.account}}]:[]),
    ...(scope.campaign?[{label:data.rows.find(row=>row.campaign_id===scope.campaign)?.campaign_name||scope.campaign,level:'adset' as Level,scope:{account:scope.account,campaign:scope.campaign}}]:[]),
    ...(scope.adset?[{label:data.rows.find(row=>row.adset_id===scope.adset)?.adset_name||scope.adset,level:'ad' as Level,scope:{account:scope.account,campaign:scope.campaign,adset:scope.adset}}]:[]),
  ];

  return <section className="ads-explorer">
    <header className="ads-explorer-head"><div><span>PLATFORM EXPLORER</span><h2>Кабинеты → кампании → группы → креативы</h2><p>Навигация по рекламной структуре без перегруженной таблицы. Метрики пересчитываются на каждом уровне.</p></div><button type="button" onClick={()=>void load()} disabled={loading}>{loading?<LoaderCircle className="spin" size={15}/>:<RefreshCw size={15}/>}Обновить</button></header>

    <div className="ads-explorer-kpis">
      <article><BarChart3 size={17}/><div><span>Объектов на уровне</span><b>{nodes.length}</b></div></article>
      <article><CircleDollarSign size={17}/><div><span>Расход</span><b>{money(nodes.reduce((sum,item)=>sum+item.spend,0))}</b></div></article>
      <article><Target size={17}/><div><span>Лиды</span><b>{number(nodes.reduce((sum,item)=>sum+item.leads,0))}</b></div></article>
      <article><ShieldCheck size={17}/><div><span>Event delivery</span><b>{health.total?`${health.rate}%`:'Нет событий'}</b></div></article>
    </div>

    <div className="ads-explorer-health">
      <div><Sparkles size={17}/><span><b>Events / Pixel Health</b><small>{health.enabled} активных destination · {health.sent} sent · {health.pending} pending · {health.failed} failed</small></span></div>
      <span className={`ads-explorer-health-state ${health.failed?'warning':health.enabled?'ok':''}`}>{health.failed?<><AlertTriangle size={14}/>Требует внимания</>:health.enabled?<><Activity size={14}/>Работает</>:<>Не настроено</>}</span>
    </div>

    <div className="ads-explorer-toolbar">
      <div className="ads-explorer-crumbs">{crumbs.map((crumb,index)=><span key={`${crumb.level}-${index}`}><button type="button" onClick={()=>{setScope(crumb.scope);setLevel(crumb.level);}}>{crumb.label}</button>{index<crumbs.length-1&&<ChevronRight size={13}/>}</span>)}</div>
      <label><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={`Поиск: ${label(level).toLowerCase()}`}/></label>
    </div>

    {error&&<div className="ads-explorer-error"><AlertTriangle size={16}/>{error}</div>}
    <div className="ads-explorer-list">
      <div className="ads-explorer-list-head"><span>{label(level)}</span><span>Статус</span><span>Расход</span><span>Показы</span><span>Клики</span><span>Лиды</span><span>Продажи</span><span>Выручка</span></div>
      {loading?<div className="ads-explorer-empty"><LoaderCircle className="spin" size={18}/>Загрузка рекламной структуры…</div>:nodes.length===0?<div className="ads-explorer-empty">На этом уровне пока нет рекламных данных.</div>:nodes.map(node=><button type="button" className="ads-explorer-row" key={node.id} onClick={()=>level!=='ad'&&drill(node)}>
        <span className="ads-explorer-name"><b>{node.name}</b><small>{node.platform} · {node.id}{level!=='ad'&&` · ${node.children} ниже`}</small></span>
        <span><i className={`ads-explorer-status ${node.status==='ACTIVE'?'active':''}`}>{node.status||'UNKNOWN'}</i></span>
        <span>{money(node.spend)}</span><span>{number(node.impressions)}</span><span>{number(node.clicks)}</span><span>{number(node.leads)}</span><span>{number(node.sales)}</span><span>{money(node.revenue)}</span>
      </button>)}
    </div>
  </section>;
}
