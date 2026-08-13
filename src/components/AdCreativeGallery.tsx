import { useEffect, useMemo, useState } from 'react';
import { Eye, Image as ImageIcon, LoaderCircle, Play, RefreshCw, Sparkles } from 'lucide-react';
import AdPreviewDrawer from './AdPreviewDrawer';
import '../ad-creative-gallery.css';

type AdRow = {
  key:string; account_id:string; account_name:string; campaign_id:string; campaign_name:string; adset_id:string; adset_name:string; ad_id:string; ad_name:string;
  platform:string; source:string; status:string; impressions:number; clicks:number; spend:number; leads:number; sales:number; revenue:number; ctr:number; cost_per_result:number;
};
type AdResponse = { rows:AdRow[] };
type PreviewContent = { imageUrl?:string; thumbnailUrl?:string; videoId?:string; headline?:string; message?:string; callToAction?:string };
type PreviewResponse = { content?:PreviewContent };
type Creative = AdRow & { preview?:PreviewContent; previewLoading?:boolean; previewError?:boolean };

const money=(value:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(Number(value||0));
const number=(value:number)=>new Intl.NumberFormat('ru-RU').format(Number(value||0));
const isMeta=(row:AdRow)=>`${row.platform||''} ${row.source||''}`.toLowerCase().match(/meta|facebook|instagram/);

export default function AdCreativeGallery(){
  const [rows,setRows]=useState<AdRow[]>([]);
  const [previews,setPreviews]=useState<Record<string,PreviewContent>>({});
  const [failed,setFailed]=useState<Set<string>>(new Set());
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selectedAd,setSelectedAd]=useState<string|null>(null);

  const load=async()=>{
    setLoading(true);setError('');setFailed(new Set());
    try{
      const response=await fetch('/api/analytics/ad-manager?days=30');
      const body=await response.text();
      if(!response.ok)throw new Error(body||`HTTP ${response.status}`);
      const data=JSON.parse(body) as AdResponse;
      setRows(data.rows||[]);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);

  const creatives=useMemo(()=>{
    const map=new Map<string,AdRow>();
    for(const row of rows){
      if(!row.ad_id)continue;
      const current=map.get(row.ad_id);
      if(!current){map.set(row.ad_id,{...row});continue;}
      for(const key of ['impressions','clicks','spend','leads','sales','revenue'] as const)current[key]=Number(current[key]||0)+Number(row[key]||0);
    }
    return [...map.values()]
      .map(row=>({...row,ctr:row.impressions?row.clicks*100/row.impressions:0,cost_per_result:row.leads?row.spend/row.leads:0}))
      .sort((a,b)=>Number(b.spend||0)-Number(a.spend||0))
      .slice(0,12);
  },[rows]);

  useEffect(()=>{
    const targets=creatives.filter(row=>isMeta(row)&&!previews[row.ad_id]&&!failed.has(row.ad_id)).slice(0,8);
    if(!targets.length)return;
    let cancelled=false;
    void Promise.allSettled(targets.map(async row=>{
      const response=await fetch(`/api/analytics/ad-preview?adId=${encodeURIComponent(row.ad_id)}&mode=instagram`);
      const body=await response.text();
      if(!response.ok)throw new Error(body||`HTTP ${response.status}`);
      const result=JSON.parse(body) as PreviewResponse;
      return {id:row.ad_id,content:result.content||{}};
    })).then(results=>{
      if(cancelled)return;
      const next:Record<string,PreviewContent>={}; const bad:string[]=[];
      for(const result of results){
        if(result.status==='fulfilled')next[result.value.id]=result.value.content;
        else bad.push(targets[results.indexOf(result)]?.ad_id||'');
      }
      if(Object.keys(next).length)setPreviews(previous=>({...previous,...next}));
      if(bad.length)setFailed(previous=>new Set([...previous,...bad.filter(Boolean)]));
    });
    return()=>{cancelled=true;};
  },[creatives,previews,failed]);

  return <section className="creative-gallery">
    <header className="creative-gallery-head"><div><span><Sparkles size={14}/> CREATIVE LIBRARY</span><h2>Креативы в работе</h2><p>Реальные объявления с визуальным preview. Детальный анализ эффективности остаётся в «Аналитике».</p></div><button type="button" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?'spin':''} size={15}/>Обновить</button></header>
    {error&&<div className="creative-gallery-state error">{error}</div>}
    {loading?<div className="creative-gallery-state"><LoaderCircle className="spin" size={18}/>Загружаем креативы…</div>:creatives.length===0?<div className="creative-gallery-state">Рекламных креативов пока нет.</div>:<div className="creative-gallery-grid">{creatives.map(row=>{
      const preview=previews[row.ad_id]; const media=preview?.imageUrl||preview?.thumbnailUrl; const meta=Boolean(isMeta(row));
      return <article className="creative-card" key={row.ad_id}>
        <button className="creative-card-media" type="button" onClick={()=>meta&&setSelectedAd(row.ad_id)} disabled={!meta} aria-label={`Открыть ${row.ad_name}`}>
          {media?<img src={media} alt={preview?.headline||row.ad_name}/>:<div className="creative-card-placeholder"><ImageIcon size={28}/><span>{meta&&!failed.has(row.ad_id)?'Загружаем preview…':'Preview недоступен'}</span></div>}
          {preview?.videoId&&<span className="creative-video-badge"><Play size={12} fill="currentColor"/>Видео</span>}
          <span className={`creative-status ${row.status==='ACTIVE'?'active':''}`}>{row.status||'UNKNOWN'}</span>
        </button>
        <div className="creative-card-copy"><small>{row.platform||row.source||'Реклама'} · {row.account_name||'Кабинет'}</small><h3>{row.ad_name||`Ad ${row.ad_id}`}</h3><p>{preview?.headline||preview?.message||`${row.campaign_name||'Кампания'} · ${row.adset_name||'Группа'}`}</p></div>
        <div className="creative-card-metrics"><span><small>Расход</small><b>{money(row.spend)}</b></span><span><small>Лиды</small><b>{number(row.leads)}</b></span><span><small>CPL</small><b>{row.leads?money(row.cost_per_result):'—'}</b></span><span><small>CTR</small><b>{row.ctr.toFixed(2)}%</b></span></div>
        <footer><span>ID {row.ad_id}</span>{meta?<button type="button" onClick={()=>setSelectedAd(row.ad_id)}><Eye size={13}/>Открыть preview</button>:<span>Preview адаптер не подключён</span>}</footer>
      </article>;
    })}</div>}
    <AdPreviewDrawer adId={selectedAd} onClose={()=>setSelectedAd(null)}/>
  </section>;
}
