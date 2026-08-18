import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, Globe2, Link2 } from 'lucide-react';
import { authFetch } from '../services/auth';
import type { AdvertisingAccountCurrency } from '../services/api';
import '../analytics-data-quality.css';

type QualitySync = { source:string; status:string; started_at:string|null; finished_at:string|null; fetched:number; written:number; error:string|null };
type QualityCredential = { provider:string; status:string; last_verified_at:string|null; last_error:string|null; updated_at:string|null };
type QualityResponse = {
  generated_at:string; timezone:string; data_complete:boolean; unavailable:string[];
  latest:{crm_at:string|null;crm_source:string|null;ads_at:string|null;ads_platform:string|null};
  syncs:QualitySync[]; credentials:QualityCredential[];
};
type CampaignQualityRow = { platform:string; account_id:string; account_name:string; spend:number };

type Props = {
  attributionRate:number;
  timezone:string;
  campaigns:CampaignQualityRow[];
  currencies:AdvertisingAccountCurrency[];
  rates:Record<string,number>;
};

const providerLabels:Record<string,string> = { meta:'Meta', tiktok:'TikTok', google_ads:'Google Ads', ga4:'GA4', bitrix:'Bitrix24', zadarma:'Zadarma', n8n:'n8n' };
const normalizePlatform = (value:string) => {
  const key=(value||'').toLowerCase();
  if(key.includes('meta')||key.includes('facebook')||key.includes('instagram')) return 'Meta';
  if(key.includes('tiktok')) return 'TikTok';
  if(key.includes('google')) return 'Google Ads';
  return value || 'Не определено';
};
const accountKey = (platform:string,id:string,name:string) => `${normalizePlatform(platform)}::${String(id||name).replace(/^act_/,'')}`;
const parseDate = (value:string|null|undefined) => { if(!value)return null; const date=new Date(value); return Number.isNaN(date.getTime())?null:date; };
const ageHours = (value:string|null|undefined) => { const date=parseDate(value); return date ? Math.max(0,(Date.now()-date.getTime())/3600000) : null; };
const relativeTime = (value:string|null|undefined) => {
  const hours=ageHours(value); if(hours===null)return 'Нет данных';
  if(hours<1)return 'менее часа назад'; if(hours<24)return `${Math.floor(hours)} ч назад`;
  return `${Math.floor(hours/24)} дн назад`;
};
const okCredential = (status:string) => ['connected','configured','active','ok','success'].includes((status||'').toLowerCase());
const okSync = (status:string) => ['success','completed','ok'].includes((status||'').toLowerCase());

export default function AnalyticsDataQualityPanel({ attributionRate, timezone, campaigns, currencies, rates }:Props) {
  const [quality,setQuality]=useState<QualityResponse|null>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    void authFetch('/api/analytics/quality',{cache:'no-store'})
      .then(async(response)=>{const raw=await response.text(); if(!response.ok)throw new Error(raw||`HTTP ${response.status}`); return JSON.parse(raw) as QualityResponse;})
      .then((next)=>{if(active){setQuality(next);setError('');}})
      .catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:String(reason));});
    return()=>{active=false;};
  },[timezone,campaigns.length]);

  const currencyQuality=useMemo(()=>{
    const map=new Map(currencies.map((item)=>[accountKey(item.platform,item.account_id,item.account_name||''),item.currency.toUpperCase()]));
    const accounts=new Map<string,CampaignQualityRow>();
    campaigns.filter((row)=>Number(row.spend||0)>0).forEach((row)=>accounts.set(accountKey(row.platform,row.account_id,row.account_name),row));
    let covered=0; const missing:string[]=[]; const missingRates:string[]=[];
    for(const [key,row] of accounts){
      const currency=map.get(key);
      if(!currency){missing.push(row.account_name||row.account_id||row.platform);continue;}
      const rate=currency==='KZT'?1:Number(rates[currency]);
      if(!Number.isFinite(rate)||rate<=0){missingRates.push(currency);continue;}
      covered+=1;
    }
    const total=accounts.size;
    return {total,covered,percent:total?covered*100/total:100,missing,missingRates:[...new Set(missingRates)]};
  },[campaigns,currencies,rates]);

  const latestSync=useMemo(()=>{
    if(!quality?.syncs?.length)return null;
    return quality.syncs.map((item)=>({...item,date:parseDate(item.finished_at||item.started_at)})).filter((item)=>item.date).sort((a,b)=>(b.date?.getTime()||0)-(a.date?.getTime()||0))[0]||null;
  },[quality]);

  const credentialOk=quality?.credentials.filter((item)=>okCredential(item.status)&&!item.last_error).length||0;
  const credentialTotal=quality?.credentials.length||0;
  const attributionCoverage=Math.max(0,100-Number(attributionRate||0));
  const warnings:string[]=[];
  if(error)warnings.push('Диагностика источников временно недоступна.');
  for(const resource of quality?.unavailable||[])warnings.push(`Источник данных недоступен: ${resource}.`);
  for(const item of quality?.credentials||[])if(item.last_error||!okCredential(item.status))warnings.push(`${providerLabels[item.provider]||item.provider}: ${item.last_error||`статус ${item.status}`}.`);
  for(const item of quality?.syncs||[]){const age=ageHours(item.finished_at||item.started_at);if(!okSync(item.status))warnings.push(`${providerLabels[item.source]||item.source}: последняя синхронизация — ${item.status}${item.error?` (${item.error})`:''}.`);else if(age!==null&&age>36)warnings.push(`${providerLabels[item.source]||item.source}: данные не обновлялись более 36 часов.`);}
  if(attributionRate>20)warnings.push(`Неатрибутировано ${attributionRate.toFixed(1)}% лидов — проверьте UTM/click IDs и связку CRM.`);
  if(currencyQuality.missing.length)warnings.push(`Нет валюты для ${currencyQuality.missing.length} рекламных кабинетов с расходом.`);
  if(currencyQuality.missingRates.length)warnings.push(`Нет курса валют: ${currencyQuality.missingRates.join(', ')}.`);

  const overallOk=!error&&Boolean(quality?.data_complete)&&warnings.length===0;
  const activeTimezone=quality?.timezone||timezone||'—';

  return <section className={`analytics-dq ${overallOk?'analytics-dq--ok':warnings.length?'analytics-dq--warn':''}`}>
    <header><div><span>DATA QUALITY</span><h2>Качество данных</h2><p>Проверка полноты, свежести, атрибуции и финансовой сопоставимости данных этой клиники.</p></div><b className={overallOk?'ok':'warn'}>{overallOk?<><CheckCircle2 size={15}/>Данные в норме</>:<><AlertTriangle size={15}/>Требует внимания</>}</b></header>
    <div className="analytics-dq-grid">
      <article><Database size={18}/><div><span>Источники</span><strong>{quality?`${credentialOk} / ${credentialTotal}`:'Проверка…'}</strong><small>подключений без ошибок</small></div></article>
      <article><Clock3 size={18}/><div><span>Последняя синхронизация</span><strong>{latestSync?relativeTime(latestSync.finished_at||latestSync.started_at):'Нет запусков'}</strong><small>{latestSync?providerLabels[latestSync.source]||latestSync.source:'integration_runs'}</small></div></article>
      <article><Link2 size={18}/><div><span>Атрибуция</span><strong>{attributionCoverage.toFixed(1)}%</strong><small>{attributionRate.toFixed(1)}% без рекламной привязки</small></div></article>
      <article><Database size={18}/><div><span>Покрытие валют</span><strong>{currencyQuality.percent.toFixed(0)}%</strong><small>{currencyQuality.covered} из {currencyQuality.total} кабинетов с расходом</small></div></article>
      <article><Globe2 size={18}/><div><span>Timezone клиники</span><strong>{activeTimezone}</strong><small>часы и дни считаются локально</small></div></article>
    </div>
    {warnings.length>0?<div className="analytics-dq-warnings">{warnings.slice(0,8).map((warning,index)=><p key={`${warning}-${index}`}><AlertTriangle size={14}/>{warning}</p>)}</div>:quality&&<div className="analytics-dq-clean"><CheckCircle2 size={15}/>Недоступных источников, просроченных синхронизаций и финансовых разрывов не обнаружено.</div>}
  </section>;
}
