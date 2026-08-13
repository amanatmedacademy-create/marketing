import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { calculateCreativeHealth, calculateCreativeTrend, type CreativeHealth, type CreativeRowLike } from '../lib/creativeIntelligence';
import { calculateCreativeRecommendation, recommendationLabel, type CreativeRecommendationAction } from '../lib/creativeRecommendations';

type AdRow = CreativeRowLike & { ad_id: string; ad_name: string; status: string; account_name: string; campaign_name: string; adset_name: string; source?: string };
type Response = { rows?: AdRow[] };
const DAY = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (value: string, days: number) => iso(new Date(new Date(`${value}T12:00:00Z`).getTime() + days * DAY));
const active = (value: string) => String(value || '').toUpperCase() === 'ACTIVE';
const tone: Record<CreativeRecommendationAction, string> = { scale: 'var(--imds-success)', keep: 'var(--imds-blue)', watch: 'var(--imds-muted)', refresh: 'var(--imds-warning)', stop: 'var(--imds-danger)' };

export default function CreativeRecommendationsPanel() {
  const [current, setCurrent] = useState<AdRow[]>([]);
  const [previous, setPrevious] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const to = iso(new Date());

  const load = async () => {
    setLoading(true); setError('');
    try {
      const fetchRange = async (from: string, end: string) => {
        const response = await fetch(`/api/analytics/ad-manager?${new URLSearchParams({ from, to: end })}`);
        const body = await response.text();
        if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
        return JSON.parse(body) as Response;
      };
      const [now, before] = await Promise.all([fetchRange(shift(to, -6), to), fetchRange(shift(to, -13), shift(to, -7))]);
      setCurrent(now.rows || []); setPrevious(before.rows || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const previousMap = useMemo(() => new Map(previous.map(row => [row.key, row])), [previous]);
  const recommendations = useMemo(() => current.map(row => {
    const trend = calculateCreativeTrend(row, previousMap.get(row.key));
    const health: CreativeHealth = calculateCreativeHealth(row, trend);
    const recommendation = calculateCreativeRecommendation(row, trend, health, active(row.status));
    return { row, trend, health, recommendation };
  }).sort((a, b) => b.recommendation.priority - a.recommendation.priority || b.row.impressions - a.row.impressions), [current, previousMap]);

  const attention = recommendations.filter(item => item.recommendation.action === 'stop' || item.recommendation.action === 'refresh').slice(0, 8);
  const winners = recommendations.filter(item => item.recommendation.action === 'scale').slice(0, 5);
  const counts = useMemo(() => recommendations.reduce<Record<CreativeRecommendationAction, number>>((acc, item) => { acc[item.recommendation.action] += 1; return acc; }, { scale: 0, keep: 0, watch: 0, refresh: 0, stop: 0 }), [recommendations]);

  return <section style={{display:'grid',gap:12,padding:16,border:'1px solid var(--imds-border)',borderRadius:18,background:'var(--imds-glass)',boxShadow:'var(--imds-shadow-soft)'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div><span style={{display:'flex',alignItems:'center',gap:6,fontSize:10,fontWeight:900,color:'var(--imds-primary)',letterSpacing:'.1em'}}><Sparkles size={14}/> CREATIVE INTELLIGENCE · PHASE 2</span><h3 style={{margin:'5px 0 2px',fontSize:17}}>Рекомендации и действия</h3><p style={{margin:0,color:'var(--imds-muted)',fontSize:11}}>Последние 7 дней против предыдущих 7. Только рекомендации — система не меняет рекламу автоматически.</p></div><button className="button" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?'spin':''} size={14}/>Обновить</button></header>
    {loading ? <div className="marketing-hub-empty"><LoaderCircle className="spin" size={18}/> Анализируем креативы…</div> : error ? <div className="alert alert--error">{error}</div> : <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8}}>{(Object.keys(counts) as CreativeRecommendationAction[]).map(action=><article key={action} style={{padding:10,border:'1px solid var(--imds-border)',borderRadius:12,background:'var(--imds-glass-soft)'}}><small style={{display:'block',fontSize:8,fontWeight:900,color:tone[action]}}>{recommendationLabel[action]}</small><strong style={{fontSize:20}}>{counts[action]}</strong></article>)}</div>
      {attention.length>0 && <div style={{display:'grid',gap:7}}><strong style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}><AlertTriangle size={15} color="var(--imds-warning)"/>Требует внимания</strong>{attention.map(({row,recommendation,health})=><article key={row.ad_id} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10,padding:11,border:'1px solid var(--imds-border)',borderRadius:12,background:'var(--imds-surface)'}}><div style={{minWidth:0}}><b style={{display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:11}}>{row.ad_name || `Ad ${row.ad_id}`}</b><small style={{color:'var(--imds-muted)',fontSize:9}}>{row.account_name} · {row.campaign_name} · {health}</small><p style={{margin:'5px 0 0',fontSize:9,lineHeight:1.45,color:'var(--imds-text-soft)'}}>{recommendation.reason}</p></div><span style={{alignSelf:'start',padding:'5px 7px',borderRadius:999,background:'var(--imds-glass-soft)',color:tone[recommendation.action],fontSize:8,fontWeight:900}}>{recommendationLabel[recommendation.action]}</span></article>)}</div>}
      {winners.length>0 && <div style={{display:'grid',gap:7}}><strong style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}><ShieldCheck size={15} color="var(--imds-success)"/>Кандидаты на масштабирование</strong>{winners.map(({row,recommendation})=><article key={row.ad_id} style={{padding:11,border:'1px solid var(--imds-border)',borderRadius:12,background:'var(--imds-success-a10)'}}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><b style={{fontSize:11}}>{row.ad_name || `Ad ${row.ad_id}`}</b><span style={{color:tone.scale,fontSize:8,fontWeight:900}}>МАСШТАБИРОВАТЬ</span></div><p style={{margin:'5px 0 0',fontSize:9,color:'var(--imds-text-soft)'}}>{recommendation.reason}</p></article>)}</div>}
      {!attention.length && !winners.length && <div className="marketing-hub-empty">Критических сигналов и подтверждённых кандидатов на масштабирование сейчас нет.</div>}
    </>}
  </section>;
}
