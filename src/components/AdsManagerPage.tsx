import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Columns3, Download, Eye, Filter, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import AdPreviewDrawer from './AdPreviewDrawer';
import '../ads-manager.css';

type Level = 'campaign' | 'adset' | 'ad';
type SortKey = 'name' | 'spend' | 'impressions' | 'reach' | 'clicks' | 'ctr' | 'cpm' | 'leads' | 'cost_per_result' | 'sales' | 'revenue';
type Row = {
  key:string; account_id:string; account_name:string; campaign_id:string; campaign_name:string; adset_id:string; adset_name:string; ad_id:string; ad_name:string;
  platform:string; source:string; status:string; utm_source:string; utm_medium:string; utm_campaign:string; utm_content:string;
  impressions:number; reach:number; clicks:number; link_clicks:number; spend:number; leads:number; target_leads:number; arrived:number; sales:number; revenue:number;
  frequency:number; cpm:number; ctr:number; link_ctr:number; cpc:number; cost_per_result:number;
};
type AccountOption = { id:string; name:string; platform?:string };
type ResponseData = { period:{from:string;to:string;days:number}; accounts:AccountOption[]; rows:Row[] };
type SavedView = { id:string; name:string; level:Level; account:string; status:string; campaign:string; adset:string; query:string; sort:SortKey; descending:boolean; columns:string[]; from:string; to:string };

const usd = (value:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value||0);
const kzt = (value:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(value||0);
const number = (value:number) => new Intl.NumberFormat('ru-RU').format(value||0);
const defaultColumns = ['status','name','result','cost','spend','impressions','reach','frequency','clicks','ctr','cpc','cpm','sales','revenue','utm','ids'];
const columnOptions = [['status','Статус'],['result','Результат'],['cost','Цена результата'],['spend','Расход'],['impressions','Показы'],['reach','Охват*'],['frequency','Частота*'],['clicks','Клики'],['ctr','CTR'],['link_ctr','CTR ссылки'],['cpc','CPC'],['cpm','CPM'],['target','Целевые лиды'],['arrived','Пришли'],['sales','Продажи'],['revenue','Выручка'],['utm','UTM'],['ids','Идентификаторы']] as const;
const aggregateStatus = (statuses:Set<string>) => statuses.size===1 ? [...statuses][0] : statuses.has('ACTIVE') ? 'MIXED' : statuses.size ? 'MIXED' : 'UNKNOWN';

export default function AdsManagerPage() {
  const [data,setData] = useState<ResponseData>({period:{from:'',to:'',days:30},accounts:[],rows:[]});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [level,setLevel] = useState<Level>('adset');
  const [account,setAccount] = useState('all');
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('all');
  const [campaign,setCampaign] = useState('all');
  const [adset,setAdset] = useState('all');
  const [sort,setSort] = useState<SortKey>('spend');
  const [descending,setDescending] = useState(true);
  const [columns,setColumns] = useState<string[]>(defaultColumns);
  const [showColumns,setShowColumns] = useState(false);
  const [showFilters,setShowFilters] = useState(false);
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [selected,setSelected] = useState<string[]>([]);
  const [views,setViews] = useState<SavedView[]>(() => { try { return JSON.parse(localStorage.getItem('imds-ads-views') || '[]'); } catch { return []; } });
  const [viewName,setViewName] = useState('');
  const [previewAdId,setPreviewAdId] = useState<string|null>(null);

  const load = async (range?:{from?:string;to?:string}) => {
    const nextFrom=range?.from ?? from; const nextTo=range?.to ?? to;
    if(nextFrom&&nextTo&&nextFrom>nextTo){setError('Дата начала не может быть позже даты окончания');return;}
    setLoading(true); setError('');
    try {
      const params=new URLSearchParams({days:'30'}); if(nextFrom)params.set('from',nextFrom); if(nextTo)params.set('to',nextTo);
      const response=await fetch(`/api/analytics/ad-manager?${params}`); const body=await response.text();
      if(!response.ok) throw new Error(body||`HTTP ${response.status}`);
      setData(JSON.parse(body) as ResponseData); setSelected([]);
    } catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load({from:'',to:''});},[]);
  useEffect(()=>{setSelected([]);},[account,status,campaign,adset,query,sort,descending,level]);

  const campaigns=useMemo(()=>Array.from(new Map(data.rows.filter(row=>account==='all'||row.account_id===account).map(row=>[row.campaign_id,{id:row.campaign_id,name:row.campaign_name}])).values()).filter(item=>item.id),[data,account]);
  const adsets=useMemo(()=>Array.from(new Map(data.rows.filter(row=>(account==='all'||row.account_id===account)&&(campaign==='all'||row.campaign_id===campaign)).map(row=>[row.adset_id,{id:row.adset_id,name:row.adset_name}])).values()).filter(item=>item.id),[data,account,campaign]);

  const grouped=useMemo(()=>{
    const map=new Map<string,Row&{_statuses:Set<string>}>();
    for(const row of data.rows){
      if(account!=='all'&&row.account_id!==account)continue;
      if(campaign!=='all'&&row.campaign_id!==campaign)continue;
      if(adset!=='all'&&row.adset_id!==adset)continue;
      const key=level==='campaign'?`${row.account_id}:${row.campaign_id}`:level==='adset'?`${row.account_id}:${row.campaign_id}:${row.adset_id}`:row.key;
      const name=level==='campaign'?row.campaign_name:level==='adset'?row.adset_name:row.ad_name;
      const existing=map.get(key)||{...row,key,campaign_name:name,adset_name:name,ad_name:name,impressions:0,reach:0,clicks:0,link_clicks:0,spend:0,leads:0,target_leads:0,arrived:0,sales:0,revenue:0,frequency:0,cpm:0,ctr:0,link_ctr:0,cpc:0,cost_per_result:0,_statuses:new Set<string>()};
      existing._statuses.add(row.status||'UNKNOWN');
      for(const field of ['impressions','reach','clicks','link_clicks','spend','leads','target_leads','arrived','sales','revenue'] as const)existing[field]+=Number(row[field]||0);
      map.set(key,existing);
    }
    let rows=[...map.values()].map(({_statuses,...row})=>({...row,status:aggregateStatus(_statuses),frequency:row.reach?row.impressions/row.reach:0,cpm:row.impressions?row.spend*1000/row.impressions:0,ctr:row.impressions?row.clicks*100/row.impressions:0,link_ctr:row.impressions?row.link_clicks*100/row.impressions:0,cpc:row.clicks?row.spend/row.clicks:0,cost_per_result:row.leads?row.spend/row.leads:0}));
    if(status!=='all')rows=rows.filter(row=>row.status===status||(status==='ACTIVE'&&row.status==='MIXED'));
    const needle=query.trim().toLowerCase();
    if(needle)rows=rows.filter(row=>[row.campaign_name,row.adset_name,row.ad_name,row.campaign_id,row.adset_id,row.ad_id,row.utm_source,row.utm_medium,row.utm_campaign,row.utm_content].some(value=>String(value||'').toLowerCase().includes(needle)));
    const value=(row:Row)=>sort==='name'?String(level==='campaign'?row.campaign_name:level==='adset'?row.adset_name:row.ad_name).toLowerCase():Number(row[sort]||0);
    return rows.sort((a,b)=>{const av=value(a),bv=value(b);const result=typeof av==='string'?av.localeCompare(String(bv)):Number(av)-Number(bv);return descending?-result:result;});
  },[data,account,status,campaign,adset,query,sort,descending,level]);

  const label=(row:Row)=>level==='campaign'?row.campaign_name:level==='adset'?row.adset_name:row.ad_name;
  const id=(row:Row)=>level==='campaign'?row.campaign_id:level==='adset'?row.adset_id:row.ad_id;
  const toggle=(name:string)=>setColumns(previous=>previous.includes(name)?previous.filter(item=>item!==name):[...previous,name]);
  const allSelected=grouped.length>0&&grouped.every(row=>selected.includes(row.key));
  const toggleAll=()=>setSelected(allSelected?[]:grouped.map(row=>row.key));
  const activeFilters=[account!=='all',status!=='all',campaign!=='all',adset!=='all',Boolean(query),Boolean(from),Boolean(to)].filter(Boolean).length;
  const resetView=()=>{setLevel('ad');setAccount('all');setStatus('all');setCampaign('all');setAdset('all');setQuery('');setSort('spend');setDescending(true);setColumns(defaultColumns);setFrom('');setTo('');setSelected([]);void load({from:'',to:''});};
  const clearFilters=()=>{setAccount('all');setStatus('all');setCampaign('all');setAdset('all');setQuery('');setFrom('');setTo('');setSelected([]);void load({from:'',to:''});};
  const saveView=()=>{const name=viewName.trim();if(!name)return;const view:SavedView={id:crypto.randomUUID(),name,level,account,status,campaign,adset,query,sort,descending,columns,from,to};const next=[...views,view];setViews(next);localStorage.setItem('imds-ads-views',JSON.stringify(next));setViewName('');};
  const applyView=(view:SavedView)=>{setLevel(view.level);setAccount(view.account);setStatus(view.status);setCampaign(view.campaign);setAdset(view.adset);setQuery(view.query);setSort(view.sort);setDescending(view.descending);setColumns(view.columns);setFrom(view.from||'');setTo(view.to||'');setSelected([]);void load({from:view.from||'',to:view.to||''});};
  const deleteView=(idValue:string)=>{const next=views.filter(view=>view.id!==idValue);setViews(next);localStorage.setItem('imds-ads-views',JSON.stringify(next));};
  const exportCsv=()=>{const headers=['Название','ID','Статус','Результат','Цена результата','Расход USD','Показы','Охват приблизительный','Частота приблизительная','Клики','CTR','CTR ссылки','CPC USD','CPM USD','Целевые','Пришли','Продажи','Выручка KZT','UTM Source','UTM Medium','UTM Campaign','UTM Content'];const body=grouped.map(row=>[label(row),id(row),row.status,row.leads,row.cost_per_result,row.spend,row.impressions,row.reach,row.frequency,row.clicks,row.ctr,row.link_ctr,row.cpc,row.cpm,row.target_leads,row.arrived,row.sales,row.revenue,row.utm_source,row.utm_medium,row.utm_campaign,row.utm_content].map(value=>`"${String(value).replace(/"/g,'""')}"`).join(';')).join('\n');const blob=new Blob([`\uFEFF${headers.join(';')}\n${body}`],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`imds-ads-${level}-${data.period.from}-${data.period.to}.csv`;link.click();URL.revokeObjectURL(url);};

  return <div className="ads-manager-page">
    <div className="heading"><span>Advertising workspace</span><h1>Рекламные кабинеты</h1><p>Реальные кампании, группы объявлений и объявления из подключённых рекламных кабинетов.</p></div>
    <section className="ads-saved-views"><strong>Представления</strong><button type="button" className={activeFilters===0&&level==='ad'?'active':''} onClick={resetView}>Все объявления</button>{views.map(view=><div key={view.id}><button type="button" onClick={()=>applyView(view)}>{view.name}</button><button type="button" aria-label="Удалить представление" onClick={()=>deleteView(view.id)}><Trash2 size={13}/></button></div>)}<label><input value={viewName} onChange={event=>setViewName(event.target.value)} placeholder="Название представления"/><button type="button" onClick={saveView} disabled={!viewName.trim()}><Save size={14}/>Сохранить</button></label></section>
    <section className="ads-toolbar"><select value={account} onChange={event=>{setAccount(event.target.value);setCampaign('all');setAdset('all');}}><option value="all">Все рекламные аккаунты</option>{data.accounts.map(item=><option key={`${item.platform||''}:${item.id}`} value={item.id}>{item.name} · {item.id}</option>)}</select><div className="ads-level-tabs">{(['campaign','adset','ad'] as Level[]).map(item=><button type="button" className={level===item?'active':''} key={item} onClick={()=>setLevel(item)}>{item==='campaign'?'Кампании':item==='adset'?'Группы объявлений':'Объявления'}</button>)}</div><label className="ads-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Поиск по названию, ID или UTM"/></label><button className={showFilters?'active':''} type="button" onClick={()=>setShowFilters(!showFilters)}><Filter size={15}/>Фильтры{activeFilters?` (${activeFilters})`:''}</button></section>
    {showFilters&&<section className="ads-filter-panel"><label><span>Статус</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="all">Все статусы</option><option value="ACTIVE">Активные и смешанные</option><option value="PAUSED">Остановленные</option><option value="MIXED">Смешанные</option><option value="UNKNOWN">Неизвестно</option></select></label><label><span>Кампания</span><select value={campaign} onChange={event=>{setCampaign(event.target.value);setAdset('all');}}><option value="all">Все кампании</option>{campaigns.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Группа объявлений</span><select value={adset} onChange={event=>setAdset(event.target.value)}><option value="all">Все группы</option>{adsets.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Дата от</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label><span>Дата до</span><input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label><button type="button" onClick={()=>void load()}>Применить даты</button><button type="button" onClick={clearFilters}><X size={14}/>Сбросить</button></section>}
    <section className="ads-controls"><label><SlidersHorizontal size={15}/><select value={sort} onChange={event=>setSort(event.target.value as SortKey)}><option value="spend">Расход</option><option value="impressions">Показы</option><option value="reach">Охват*</option><option value="clicks">Клики</option><option value="ctr">CTR</option><option value="cpm">CPM</option><option value="leads">Результат</option><option value="cost_per_result">Цена результата</option><option value="sales">Продажи</option><option value="revenue">Выручка</option><option value="name">Название</option></select></label><button type="button" onClick={()=>setDescending(!descending)}>{descending?'По убыванию':'По возрастанию'}</button><div className="ads-columns"><button type="button" onClick={()=>setShowColumns(!showColumns)}><Columns3 size={15}/>Столбцы ({columns.length})<ChevronDown size={14}/></button>{showColumns&&<div>{columnOptions.map(([key,title])=><label key={key}><input type="checkbox" checked={columns.includes(key)} onChange={()=>toggle(key)}/>{title}</label>)}</div>}</div><button type="button" onClick={exportCsv} disabled={!grouped.length}><Download size={15}/>Экспорт</button>{selected.length>0&&<strong className="ads-selected">Выбрано на экране: {selected.length}</strong>}<span>{grouped.length} записей · {data.period.from} — {data.period.to}</span></section>
    {loading&&<section className="panel">Загрузка рекламных данных…</section>}{error&&<section className="panel">{error}</section>}
    {!loading&&!error&&<section className="ads-table-wrap"><table><thead><tr><th><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th>{columns.includes('status')&&<th>Статус</th>}<th>{level==='campaign'?'Кампания':level==='adset'?'Группа объявлений':'Объявление'}</th>{columns.includes('result')&&<th>Результат</th>}{columns.includes('cost')&&<th>Цена результата</th>}{columns.includes('spend')&&<th>Расход</th>}{columns.includes('impressions')&&<th>Показы</th>}{columns.includes('reach')&&<th>Охват*</th>}{columns.includes('frequency')&&<th>Частота*</th>}{columns.includes('clicks')&&<th>Клики</th>}{columns.includes('ctr')&&<th>CTR</th>}{columns.includes('link_ctr')&&<th>CTR ссылки</th>}{columns.includes('cpc')&&<th>CPC</th>}{columns.includes('cpm')&&<th>CPM</th>}{columns.includes('target')&&<th>Целевые</th>}{columns.includes('arrived')&&<th>Пришли</th>}{columns.includes('sales')&&<th>Продажи</th>}{columns.includes('revenue')&&<th>Выручка</th>}{columns.includes('utm')&&<th>UTM</th>}{columns.includes('ids')&&<th>Идентификаторы</th>}</tr></thead><tbody>{grouped.map(row=><tr key={row.key} className={selected.includes(row.key)?'selected':''}><td><input type="checkbox" checked={selected.includes(row.key)} onChange={()=>setSelected(previous=>previous.includes(row.key)?previous.filter(key=>key!==row.key):[...previous,row.key])}/></td>{columns.includes('status')&&<td><span className={`ads-status ${row.status==='ACTIVE'?'active':''}`}/><small>{row.status}</small></td>}<td><strong>{label(row)||'Без названия'}</strong><small>{row.account_name}</small>{level==='ad'&&row.ad_id&&<button className="ad-preview-trigger" type="button" onClick={()=>setPreviewAdId(row.ad_id)}><Eye size={12}/>Превью</button>}</td>{columns.includes('result')&&<td>{number(row.leads)}<small>результатов</small></td>}{columns.includes('cost')&&<td>{usd(row.cost_per_result)}</td>}{columns.includes('spend')&&<td>{usd(row.spend)}</td>}{columns.includes('impressions')&&<td>{number(row.impressions)}</td>}{columns.includes('reach')&&<td>{number(row.reach)}*</td>}{columns.includes('frequency')&&<td>{row.frequency.toFixed(2)}*</td>}{columns.includes('clicks')&&<td>{number(row.clicks)}</td>}{columns.includes('ctr')&&<td>{row.ctr.toFixed(2)}%</td>}{columns.includes('link_ctr')&&<td>{row.link_ctr.toFixed(2)}%</td>}{columns.includes('cpc')&&<td>{usd(row.cpc)}</td>}{columns.includes('cpm')&&<td>{usd(row.cpm)}</td>}{columns.includes('target')&&<td>{number(row.target_leads)}</td>}{columns.includes('arrived')&&<td>{number(row.arrived)}</td>}{columns.includes('sales')&&<td>{number(row.sales)}</td>}{columns.includes('revenue')&&<td>{kzt(row.revenue)}</td>}{columns.includes('utm')&&<td><small>source: {row.utm_source||'—'}<br/>medium: {row.utm_medium||'—'}<br/>campaign: {row.utm_campaign||'—'}<br/>content: {row.utm_content||'—'}</small></td>}{columns.includes('ids')&&<td><small>Campaign: {row.campaign_id||'—'}<br/>Ad set: {row.adset_id||'—'}<br/>Ad: {row.ad_id||'—'}</small></td>}</tr>)}</tbody></table><p>* Охват и частота приблизительные при суммировании нескольких объявлений или дней.</p></section>}
    <AdPreviewDrawer adId={previewAdId} onClose={()=>setPreviewAdId(null)}/>
  </div>;
}
