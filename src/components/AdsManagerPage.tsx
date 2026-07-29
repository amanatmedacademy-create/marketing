import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Columns3, Download, Filter, Search, SlidersHorizontal } from 'lucide-react';
import '../ads-manager.css';

type Level = 'campaign' | 'adset' | 'ad';
type SortKey = 'name' | 'spend' | 'impressions' | 'reach' | 'clicks' | 'ctr' | 'cpm' | 'leads' | 'cost_per_result';
type Row = {
  key:string; account_id:string; account_name:string; campaign_id:string; campaign_name:string; adset_id:string; adset_name:string; ad_id:string; ad_name:string;
  platform:string; source:string; status:string; utm_source:string; utm_medium:string; utm_campaign:string; utm_content:string;
  impressions:number; reach:number; clicks:number; link_clicks:number; spend:number; leads:number; target_leads:number; arrived:number; sales:number; revenue:number;
  frequency:number; cpm:number; ctr:number; link_ctr:number; cpc:number; cost_per_result:number;
};
type ResponseData = { period:{from:string;to:string;days:number}; accounts:Array<{id:string;name:string}>; rows:Row[] };

const usd = (value:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value||0);
const number = (value:number) => new Intl.NumberFormat('ru-RU').format(value||0);
const defaultColumns = ['status','name','result','cost','budget','spend','impressions','reach','frequency','clicks','ctr','cpc','cpm','ids'];

export default function AdsManagerPage() {
  const [data,setData] = useState<ResponseData>({period:{from:'',to:'',days:30},accounts:[],rows:[]});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [level,setLevel] = useState<Level>('adset');
  const [account,setAccount] = useState('all');
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('all');
  const [sort,setSort] = useState<SortKey>('spend');
  const [descending,setDescending] = useState(true);
  const [columns,setColumns] = useState<string[]>(defaultColumns);
  const [showColumns,setShowColumns] = useState(false);

  useEffect(() => {
    fetch('/api/analytics/ad-manager?days=30')
      .then(async response => { const body = await response.text(); if(!response.ok) throw new Error(body || `HTTP ${response.status}`); return JSON.parse(body) as ResponseData; })
      .then(setData).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false));
  },[]);

  const grouped = useMemo(() => {
    const map = new Map<string,Row>();
    for(const row of data.rows){
      if(account!=='all' && row.account_id!==account) continue;
      if(status!=='all' && row.status!==status) continue;
      const key = level==='campaign' ? `${row.account_id}:${row.campaign_id}` : level==='adset' ? `${row.account_id}:${row.campaign_id}:${row.adset_id}` : row.key;
      const name = level==='campaign' ? row.campaign_name : level==='adset' ? row.adset_name : row.ad_name;
      const existing = map.get(key) || {...row,key,campaign_name:name,impressions:0,reach:0,clicks:0,link_clicks:0,spend:0,leads:0,target_leads:0,arrived:0,sales:0,revenue:0,frequency:0,cpm:0,ctr:0,link_ctr:0,cpc:0,cost_per_result:0};
      for(const field of ['impressions','reach','clicks','link_clicks','spend','leads','target_leads','arrived','sales','revenue'] as const) existing[field]+=row[field];
      map.set(key,existing);
    }
    const rows=[...map.values()].map(row=>({...row,frequency:row.reach?row.impressions/row.reach:0,cpm:row.impressions?row.spend*1000/row.impressions:0,ctr:row.impressions?row.clicks*100/row.impressions:0,link_ctr:row.impressions?row.link_clicks*100/row.impressions:0,cpc:row.clicks?row.spend/row.clicks:0,cost_per_result:row.leads?row.spend/row.leads:0}));
    const needle=query.trim().toLowerCase();
    const filtered=needle?rows.filter(row=>[row.campaign_name,row.adset_name,row.ad_name,row.campaign_id,row.adset_id,row.ad_id,row.utm_source,row.utm_medium,row.utm_campaign].some(value=>String(value||'').toLowerCase().includes(needle))):rows;
    const value=(row:Row)=>sort==='name'?String(level==='campaign'?row.campaign_name:level==='adset'?row.adset_name:row.ad_name).toLowerCase():Number(row[sort]||0);
    return filtered.sort((a,b)=>{const av=value(a),bv=value(b); const result=typeof av==='string'?av.localeCompare(String(bv)):Number(av)-Number(bv); return descending?-result:result;});
  },[data,account,status,query,sort,descending,level]);

  const label=(row:Row)=>level==='campaign'?row.campaign_name:level==='adset'?row.adset_name:row.ad_name;
  const id=(row:Row)=>level==='campaign'?row.campaign_id:level==='adset'?row.adset_id:row.ad_id;
  const toggle=(name:string)=>setColumns(previous=>previous.includes(name)?previous.filter(item=>item!==name):[...previous,name]);
  const exportCsv=()=>{const headers=['Название','ID','Статус','Результат','Цена результата','Расход','Показы','Охват','Частота','Клики','CTR','CPC','CPM'];const body=grouped.map(row=>[label(row),id(row),row.status,row.leads,row.cost_per_result,row.spend,row.impressions,row.reach,row.frequency,row.clicks,row.ctr,row.cpc,row.cpm].map(value=>`"${String(value).replace(/"/g,'""')}"`).join(';')).join('\n');const blob=new Blob([`\uFEFF${headers.join(';')}\n${body}`],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`imds-ads-${level}.csv`;link.click();URL.revokeObjectURL(url);};

  return <div className="ads-manager-page">
    <div className="heading"><span>Meta Ads workspace</span><h1>Рекламные кабинеты</h1><p>Управление и анализ кампаний, групп объявлений и объявлений.</p></div>
    <section className="ads-toolbar">
      <select value={account} onChange={event=>setAccount(event.target.value)}><option value="all">Все рекламные аккаунты</option>{data.accounts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select>
      <div className="ads-level-tabs">{(['campaign','adset','ad'] as Level[]).map(item=><button className={level===item?'active':''} key={item} onClick={()=>setLevel(item)}>{item==='campaign'?'Кампании':item==='adset'?'Группы объявлений':'Объявления'}</button>)}</div>
      <label className="ads-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Поиск по названию, ID или UTM"/></label>
    </section>
    <section className="ads-controls">
      <label><Filter size={15}/><select value={status} onChange={event=>setStatus(event.target.value)}><option value="all">Все статусы</option><option value="ACTIVE">Активные</option><option value="PAUSED">Остановленные</option><option value="UNKNOWN">Неизвестно</option></select></label>
      <label><SlidersHorizontal size={15}/><select value={sort} onChange={event=>setSort(event.target.value as SortKey)}><option value="spend">Расход</option><option value="impressions">Показы</option><option value="reach">Охват</option><option value="clicks">Клики</option><option value="ctr">CTR</option><option value="cpm">CPM</option><option value="leads">Результат</option><option value="cost_per_result">Цена результата</option><option value="name">Название</option></select></label>
      <button onClick={()=>setDescending(!descending)}>{descending?'По убыванию':'По возрастанию'}</button>
      <div className="ads-columns"><button onClick={()=>setShowColumns(!showColumns)}><Columns3 size={15}/>Столбцы<ChevronDown size={14}/></button>{showColumns&&<div>{[['status','Статус'],['result','Результат'],['cost','Цена результата'],['spend','Расход'],['impressions','Показы'],['reach','Охват'],['frequency','Частота'],['clicks','Клики'],['ctr','CTR'],['cpc','CPC'],['cpm','CPM'],['ids','Идентификаторы']].map(([key,title])=><label key={key}><input type="checkbox" checked={columns.includes(key)} onChange={()=>toggle(key)}/>{title}</label>)}</div>}</div>
      <button onClick={exportCsv}><Download size={15}/>Экспорт</button>
      <span>{grouped.length} записей · {data.period.from} — {data.period.to}</span>
    </section>
    {loading&&<section className="panel">Загрузка рекламных данных…</section>}{error&&<section className="panel">{error}</section>}
    {!loading&&!error&&<section className="ads-table-wrap"><table><thead><tr><th><input type="checkbox"/></th>{columns.includes('status')&&<th>Вкл./выкл.</th>}<th>{level==='campaign'?'Кампания':level==='adset'?'Группа объявлений':'Объявление'}</th>{columns.includes('result')&&<th>Результат</th>}{columns.includes('cost')&&<th>Цена результата</th>}{columns.includes('spend')&&<th>Расход</th>}{columns.includes('impressions')&&<th>Показы</th>}{columns.includes('reach')&&<th>Охват</th>}{columns.includes('frequency')&&<th>Частота</th>}{columns.includes('clicks')&&<th>Клики</th>}{columns.includes('ctr')&&<th>CTR</th>}{columns.includes('cpc')&&<th>CPC</th>}{columns.includes('cpm')&&<th>CPM</th>}{columns.includes('ids')&&<th>Идентификаторы</th>}</tr></thead><tbody>{grouped.map(row=><tr key={row.key}><td><input type="checkbox"/></td>{columns.includes('status')&&<td><span className={`ads-status ${row.status==='ACTIVE'?'active':''}`}/></td>}<td><strong>{label(row)}</strong><small>{row.account_name}</small></td>{columns.includes('result')&&<td>{number(row.leads)}<small>результатов</small></td>}{columns.includes('cost')&&<td>{usd(row.cost_per_result)}</td>}{columns.includes('spend')&&<td>{usd(row.spend)}</td>}{columns.includes('impressions')&&<td>{number(row.impressions)}</td>}{columns.includes('reach')&&<td>{number(row.reach)}</td>}{columns.includes('frequency')&&<td>{row.frequency.toFixed(2)}</td>}{columns.includes('clicks')&&<td>{number(row.clicks)}</td>}{columns.includes('ctr')&&<td>{row.ctr.toFixed(2)}%</td>}{columns.includes('cpc')&&<td>{usd(row.cpc)}</td>}{columns.includes('cpm')&&<td>{usd(row.cpm)}</td>}{columns.includes('ids')&&<td><small>Campaign: {row.campaign_id||'—'}<br/>Ad set: {row.adset_id||'—'}<br/>Ad: {row.ad_id||'—'}</small></td>}</tr>)}</tbody></table></section>}
  </div>;
}
