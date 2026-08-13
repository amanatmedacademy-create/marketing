import { useEffect, useMemo, useState } from 'react';
import { Eye, Image as ImageIcon, LoaderCircle, Play, RefreshCw, Sparkles } from 'lucide-react';
import AdPreviewDrawer from './AdPreviewDrawer';
import { marketingApi, type AdvertisingAccountCurrency } from '../services/api';

type AdRow = {
  key:string; account_id:string; account_name:string; campaign_id:string; campaign_name:string; adset_id:string; adset_name:string; ad_id:string; ad_name:string;
  platform:string; source:string; status:string; impressions:number; clicks:number; spend:number; leads:number; sales:number; revenue:number; ctr:number; cost_per_result:number;
};
type AdResponse = { rows:AdRow[] };
type PreviewContent = { imageUrl?:string; thumbnailUrl?:string; videoId?:string; headline?:string; message?:string; callToAction?:string };
type PreviewResponse = { content?:PreviewContent };

const number=(value:number)=>new Intl.NumberFormat('ru-RU').format(Number(value||0));
const normalizedPlatform=(value:string)=>{const provider=(value||'').toLowerCase();if(provider.includes('tiktok'))return 'TikTok';if(provider.includes('meta')||provider.includes('facebook')||provider.includes('instagram'))return 'Meta';return value||'Не определено';};
const accountCurrencyKey=(platform:string,id:string)=>`${normalizedPlatform(platform)}:${String(id||'').replace(/^act_/,'')}`;
const formatNativeMoney=(value:number,currency?:string|null)=>{if(!currency)return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value||0))} · валюта не определена`;try{return new Intl.NumberFormat('ru-RU',{style:'currency',currency,minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));}catch{return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value||0))} ${currency}`;}};
const isMeta=(row:AdRow)=>/meta|facebook|instagram/.test(`${row.platform||''} ${row.source||''}`.toLowerCase());
const panel:React.CSSProperties={display:'grid',gap:14,padding:18,border:'1px solid var(--imds-border)',borderRadius:20,background:'var(--imds-glass)',boxShadow:'var(--imds-shadow-soft)'};
const grid:React.CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:11};
const card:React.CSSProperties={display:'grid',minWidth:0,border:'1px solid var(--imds-border)',borderRadius:16,overflow:'hidden',background:'var(--imds-surface)',boxShadow:'var(--imds-shadow-soft)'};
const mediaButton:React.CSSProperties={position:'relative',width:'100%',aspectRatio:'1.08 / 1',border:0,padding:0,background:'var(--imds-surface-2)',color:'var(--imds-muted)',overflow:'hidden'};

export default function AdCreativeGallery(){
  const [rows,setRows]=useState<AdRow[]>([]);
  const [currencies,setCurrencies]=useState<AdvertisingAccountCurrency[]>([]);
  const [previews,setPreviews]=useState<Record<string,PreviewContent>>({});
  const [failed,setFailed]=useState<Set<string>>(new Set());
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selectedAd,setSelectedAd]=useState<string|null>(null);

  const load=async()=>{
    setLoading(true);setError('');setFailed(new Set());
    try{
      const [response,currencyResponse]=await Promise.all([fetch('/api/analytics/ad-manager?days=30'),marketingApi.adCurrencies().catch(()=>({accounts:[]}))]);
      const body=await response.text();
      if(!response.ok)throw new Error(body||`HTTP ${response.status}`);
      const data=JSON.parse(body) as AdResponse;
      setRows(data.rows||[]);setCurrencies(currencyResponse.accounts||[]);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);

  const currencyByAccount=useMemo(()=>new Map(currencies.map(item=>[accountCurrencyKey(item.platform,item.account_id),item.currency.toUpperCase()])),[currencies]);
  const currencyFor=(row:AdRow)=>currencyByAccount.get(accountCurrencyKey(row.platform,row.account_id))||null;

  const creatives=useMemo(()=>{
    const map=new Map<string,AdRow>();
    for(const row of rows){
      if(!row.ad_id)continue;
      const current=map.get(row.ad_id);
      if(!current){map.set(row.ad_id,{...row});continue;}
      for(const key of ['impressions','clicks','spend','leads','sales','revenue'] as const)current[key]=Number(current[key]||0)+Number(row[key]||0);
    }
    return [...map.values()].map(row=>({...row,ctr:row.impressions?row.clicks*100/row.impressions:0,cost_per_result:row.leads?row.spend/row.leads:0})).sort((a,b)=>Number(b.spend||0)-Number(a.spend||0)).slice(0,12);
  },[rows]);

  useEffect(()=>{
    const targets=creatives.filter(row=>isMeta(row)&&!previews[row.ad_id]&&!failed.has(row.ad_id)).slice(0,8);
    if(!targets.length)return;
    let cancelled=false;
    void Promise.allSettled(targets.map(async row=>{const response=await fetch(`/api/analytics/ad-preview?adId=${encodeURIComponent(row.ad_id)}&mode=instagram`);const body=await response.text();if(!response.ok)throw new Error(body||`HTTP ${response.status}`);const result=JSON.parse(body) as PreviewResponse;return {id:row.ad_id,content:result.content||{}};})).then(results=>{if(cancelled)return;const next:Record<string,PreviewContent>={};const bad:string[]=[];results.forEach((result,index)=>{if(result.status==='fulfilled')next[result.value.id]=result.value.content;else bad.push(targets[index]?.ad_id||'');});if(Object.keys(next).length)setPreviews(previous=>({...previous,...next}));if(bad.length)setFailed(previous=>new Set([...previous,...bad.filter(Boolean)]));});
    return()=>{cancelled=true;};
  },[creatives,previews,failed]);

  return <section style={panel}>
    <header style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}><div style={{display:'grid',gap:5}}><span style={{display:'flex',alignItems:'center',gap:6,fontSize:10,fontWeight:850,letterSpacing:'.12em',color:'var(--imds-primary)'}}><Sparkles size={14}/> CREATIVE LIBRARY</span><h2 style={{margin:0,fontSize:20}}>Креативы в работе</h2><p style={{margin:0,color:'var(--imds-muted)',fontSize:12}}>Реальные объявления с preview изображения/видео. Расход и CPL показываются в валюте рекламного кабинета.</p></div><button className="button" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?'spin':''} size={15}/>Обновить</button></header>
    {error&&<div className="alert alert--error">{error}</div>}
    {loading?<div className="marketing-hub-empty"><LoaderCircle className="spin" size={18}/> Загружаем креативы…</div>:creatives.length===0?<div className="marketing-hub-empty">Рекламных креативов пока нет.</div>:<div style={grid}>{creatives.map(row=>{
      const preview=previews[row.ad_id];const media=preview?.imageUrl||preview?.thumbnailUrl;const meta=isMeta(row);const currency=currencyFor(row);
      return <article style={card} key={row.ad_id}>
        <button type="button" style={{...mediaButton,cursor:meta?'pointer':'default'}} onClick={()=>meta&&setSelectedAd(row.ad_id)} disabled={!meta} aria-label={`Открыть ${row.ad_name}`}>
          {media?<img src={media} alt={preview?.headline||row.ad_name} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>:<div style={{height:'100%',display:'grid',placeContent:'center',justifyItems:'center',gap:8,fontSize:10}}><ImageIcon size={28}/><span>{meta&&!failed.has(row.ad_id)?'Загружаем preview…':'Preview недоступен'}</span></div>}
          {preview?.videoId&&<span style={{position:'absolute',left:9,top:9,display:'flex',alignItems:'center',gap:4,padding:'5px 7px',borderRadius:999,background:'var(--imds-surface)',color:'var(--imds-text)',fontSize:9,fontWeight:850}}><Play size={12} fill="currentColor"/>Видео</span>}
          <span style={{position:'absolute',right:9,top:9,padding:'5px 7px',borderRadius:999,background:row.status==='ACTIVE'?'var(--imds-success-a10)':'var(--imds-surface)',color:row.status==='ACTIVE'?'var(--imds-success)':'var(--imds-muted)',fontSize:9,fontWeight:850}}>{row.status||'UNKNOWN'}</span>
        </button>
        <div style={{display:'grid',gap:4,padding:'12px 12px 8px'}}><small style={{color:'var(--imds-muted)',fontSize:9}}>{row.platform||row.source||'Реклама'} · {row.account_name||'Кабинет'}{currency?` · ${currency}`:''}</small><strong style={{fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.ad_name||`Ad ${row.ad_id}`}</strong><p style={{margin:0,color:'var(--imds-text-soft)',fontSize:10,lineHeight:1.4,minHeight:28}}>{preview?.headline||preview?.message||`${row.campaign_name||'Кампания'} · ${row.adset_name||'Группа'}`}</p></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,padding:'6px 12px 12px'}}>{[['Расход',formatNativeMoney(row.spend,currency)],['Лиды',number(row.leads)],['CPL',row.leads?formatNativeMoney(row.cost_per_result,currency):'—'],['CTR',`${row.ctr.toFixed(2)}%`]].map(([label,value])=><span key={label} style={{display:'grid',gap:2,padding:'7px 8px',borderRadius:9,background:'var(--imds-glass-soft)'}}><small style={{fontSize:8,color:'var(--imds-muted)'}}>{label}</small><b style={{fontSize:11}}>{value}</b></span>)}</div>
        <footer style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,borderTop:'1px solid var(--imds-border)',padding:'9px 12px',color:'var(--imds-muted)',fontSize:8}}><span>ID {row.ad_id}</span>{meta?<button type="button" className="marketing-hub-text-button" onClick={()=>setSelectedAd(row.ad_id)} style={{fontSize:9}}><Eye size={13}/>Preview</button>:<span>Адаптер preview не подключён</span>}</footer>
      </article>;
    })}</div>}
    <AdPreviewDrawer adId={selectedAd} onClose={()=>setSelectedAd(null)}/>
  </section>;
}
