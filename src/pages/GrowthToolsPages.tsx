import { useEffect, useMemo, useState } from 'react';
import { Clipboard, ExternalLink, Link2, Megaphone, Plus, RefreshCw, Save, Target, UsersRound } from 'lucide-react';
import { operationsApi, type LeadForm, type MediaPlanItem, type TrackingLink } from '../services/operations';
import '../marketing-suite.css';

const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));

function Header({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="suite-page-head"><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div></div>;
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return <button className="button" type="button" onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}><Clipboard size={15}/>{done ? 'Скопировано' : 'Копировать'}</button>;
}

export function LeadFormsPage() {
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', source: 'Website', campaign: '', success_message: 'Спасибо! Мы свяжемся с вами.' });
  const load = async () => { try { setForms(await operationsApi.forms.list()); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось загрузить формы'); } };
  useEffect(() => { void load(); }, []);
  const create = async () => {
    if (!form.name.trim()) return;
    try { setForms(await operationsApi.forms.create({ ...form, status: 'active' })); setForm({ name: '', source: 'Website', campaign: '', success_message: 'Спасибо! Мы свяжемся с вами.' }); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось создать форму'); }
  };
  const toggle = async (item: LeadForm) => { try { setForms(await operationsApi.forms.update(item.id, { status: item.status === 'active' ? 'inactive' : 'active' })); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось изменить статус'); } };
  const endpoint = (item: LeadForm) => `${location.origin}/api/webhooks/lead-forms/${item.public_token}`;
  const embed = (item: LeadForm) => `<form id="imds-form"><input name="name" placeholder="Имя" required><input name="phone" placeholder="Телефон" required><input name="email" placeholder="Email"><button>Отправить</button></form><script>document.getElementById('imds-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const u=new URL(location.href);const body=Object.fromEntries(f.entries());['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','ttclid'].forEach(k=>body[k]=u.searchParams.get(k)||'');body.page_url=location.href;body.referrer=document.referrer;const r=await fetch('${endpoint(item)}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();alert(j.successMessage||j.error||'Готово');});</script>`;
  return <div className="stack suite-page"><Header eyebrow="Lead Capture" title="Формы захвата лидов" text="Создавайте публичные формы, которые сразу записывают заявки в marketing_leads вместе с UTM, fbclid и ttclid."/>{message && <div className="alert">{message}</div>}
    <div className="suite-two-col"><section className="panel suite-form"><h2>Новая форма</h2><label>Название<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Форма сайта — консультация"/></label><label>Источник<input value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></label><label>Кампания<input value={form.campaign} onChange={e=>setForm({...form,campaign:e.target.value})}/></label><label>Сообщение после отправки<input value={form.success_message} onChange={e=>setForm({...form,success_message:e.target.value})}/></label><button className="button button--primary" onClick={()=>void create()}><Plus size={16}/>Создать форму</button></section>
      <section className="panel"><div className="suite-section-title"><div><h2>Активные формы</h2><p>{forms.length} форм</p></div><button className="button" onClick={()=>void load()}><RefreshCw size={15}/>Обновить</button></div><div className="suite-automation-list">{forms.map(item=><article key={item.id}><div className="suite-journey-node"><span>FORM</span><b>{item.name}</b><small>{item.source || 'Источник не задан'} · {item.campaign || 'без кампании'}</small></div><div className="suite-journey-node"><span>ENDPOINT</span><b>{endpoint(item)}</b></div><button className={item.status==='active'?'status-pill status-pill--ok':'status-pill'} onClick={()=>void toggle(item)}>{item.status==='active'?'Активна':'Отключена'}</button><CopyButton value={embed(item)}/></article>)}</div></section></div>
  </div>;
}

function buildUtm(values: { destination_url:string; utm_source:string; utm_medium:string; utm_campaign:string; utm_content:string; utm_term:string }) {
  try { const url = new URL(values.destination_url); (['utm_source','utm_medium','utm_campaign','utm_content','utm_term'] as const).forEach(key => { if (values[key].trim()) url.searchParams.set(key, values[key].trim()); }); return url.toString(); } catch { return ''; }
}

export function UtmBuilderPage() {
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [name, setName] = useState('');
  const [values, setValues] = useState({ destination_url:'',utm_source:'instagram',utm_medium:'paid_social',utm_campaign:'',utm_content:'',utm_term:'' });
  const [message,setMessage]=useState<string|null>(null);
  const finalUrl = useMemo(()=>buildUtm(values),[values]);
  const load=async()=>{try{setLinks(await operationsApi.links.list());}catch(error){setMessage(error instanceof Error?error.message:'Не удалось загрузить ссылки');}};
  useEffect(()=>{void load();},[]);
  const save=async()=>{if(!name.trim()||!finalUrl)return;try{setLinks(await operationsApi.links.create({name,...values,final_url:finalUrl}));setName('');}catch(error){setMessage(error instanceof Error?error.message:'Не удалось сохранить ссылку');}};
  return <div className="stack suite-page"><Header eyebrow="Attribution" title="UTM Builder" text="Генератор и библиотека отслеживаемых ссылок для рекламных кампаний."/>{message&&<div className="alert">{message}</div>}
    <div className="suite-two-col"><section className="panel suite-form"><h2>Собрать ссылку</h2><label>Название<input value={name} onChange={e=>setName(e.target.value)} placeholder="Instagram · Имплантация · Август"/></label><label>Целевая ссылка<input value={values.destination_url} onChange={e=>setValues({...values,destination_url:e.target.value})} placeholder="https://site.kz/service"/></label><label>utm_source<input value={values.utm_source} onChange={e=>setValues({...values,utm_source:e.target.value})}/></label><label>utm_medium<input value={values.utm_medium} onChange={e=>setValues({...values,utm_medium:e.target.value})}/></label><label>utm_campaign<input value={values.utm_campaign} onChange={e=>setValues({...values,utm_campaign:e.target.value})}/></label><label>utm_content<input value={values.utm_content} onChange={e=>setValues({...values,utm_content:e.target.value})}/></label><label>utm_term<input value={values.utm_term} onChange={e=>setValues({...values,utm_term:e.target.value})}/></label>{finalUrl&&<div className="suite-template-preview"><span>FINAL URL</span><p>{finalUrl}</p><div><CopyButton value={finalUrl}/></div></div>}<button className="button button--primary" disabled={!finalUrl||!name.trim()} onClick={()=>void save()}><Save size={16}/>Сохранить</button></section>
      <section className="panel"><h2>Сохранённые ссылки</h2><div className="suite-recipient-list">{links.map(link=><div key={link.id}><b>{link.name}</b><span>{link.utm_source || '—'} / {link.utm_medium || '—'}</span><small><a href={link.final_url} target="_blank" rel="noreferrer"><ExternalLink size={12}/> открыть</a></small></div>)}</div></section></div>
  </div>;
}

export function MediaPlanPage() {
  const [items,setItems]=useState<MediaPlanItem[]>([]); const [message,setMessage]=useState<string|null>(null);
  const [form,setForm]=useState({month:new Date().toISOString().slice(0,7)+'-01',channel:'Meta Ads',campaign:'',planned_budget:0,target_leads:0,target_sales:0,target_revenue:0,owner:'',status:'План' as MediaPlanItem['status']});
  const load=async()=>{try{setItems(await operationsApi.mediaPlan.list());}catch(error){setMessage(error instanceof Error?error.message:'Не удалось загрузить медиаплан');}}; useEffect(()=>{void load();},[]);
  const totals=useMemo(()=>items.reduce((a,x)=>({budget:a.budget+Number(x.planned_budget||0),leads:a.leads+Number(x.target_leads||0),sales:a.sales+Number(x.target_sales||0),revenue:a.revenue+Number(x.target_revenue||0)}),{budget:0,leads:0,sales:0,revenue:0}),[items]);
  const create=async()=>{try{setItems(await operationsApi.mediaPlan.create(form));setForm({...form,campaign:'',planned_budget:0,target_leads:0,target_sales:0,target_revenue:0});}catch(error){setMessage(error instanceof Error?error.message:'Не удалось добавить план');}};
  return <div className="stack suite-page"><Header eyebrow="Planning" title="Медиаплан" text="План бюджета, лидов, продаж и выручки по каналам и кампаниям."/>{message&&<div className="alert">{message}</div>}
    <div className="suite-kpis"><article><Megaphone/><span>Плановый бюджет</span><strong>{money(totals.budget)}</strong></article><article><UsersRound/><span>Цель лидов</span><strong>{number(totals.leads)}</strong></article><article><Target/><span>Цель продаж</span><strong>{number(totals.sales)}</strong></article><article><Link2/><span>Цель выручки</span><strong>{money(totals.revenue)}</strong></article></div>
    <div className="suite-two-col"><section className="panel suite-form"><h2>Добавить строку</h2><label>Месяц<input type="date" value={form.month} onChange={e=>setForm({...form,month:e.target.value})}/></label><label>Канал<input value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}/></label><label>Кампания<input value={form.campaign} onChange={e=>setForm({...form,campaign:e.target.value})}/></label><label>Бюджет<input type="number" value={form.planned_budget} onChange={e=>setForm({...form,planned_budget:Number(e.target.value)})}/></label><label>Лиды<input type="number" value={form.target_leads} onChange={e=>setForm({...form,target_leads:Number(e.target.value)})}/></label><label>Продажи<input type="number" value={form.target_sales} onChange={e=>setForm({...form,target_sales:Number(e.target.value)})}/></label><label>Выручка<input type="number" value={form.target_revenue} onChange={e=>setForm({...form,target_revenue:Number(e.target.value)})}/></label><label>Ответственный<input value={form.owner} onChange={e=>setForm({...form,owner:e.target.value})}/></label><button className="button button--primary" onClick={()=>void create()}><Plus size={16}/>Добавить</button></section>
      <section className="panel"><h2>План по каналам</h2><div className="table-wrap"><table><thead><tr><th>Месяц</th><th>Канал</th><th>Кампания</th><th>Бюджет</th><th>Лиды</th><th>Продажи</th><th>Выручка</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.month}</td><td><b>{item.channel}</b></td><td>{item.campaign||'—'}</td><td>{money(item.planned_budget)}</td><td>{number(item.target_leads)}</td><td>{number(item.target_sales)}</td><td>{money(item.target_revenue)}</td></tr>)}</tbody></table></div></section></div>
  </div>;
}
