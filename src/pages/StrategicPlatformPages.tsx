import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, CheckCircle2, CircleDollarSign, Database, Play, RefreshCw, Save, UsersRound, Workflow } from 'lucide-react';
import { useAuth } from '../components/AuthGate';
import { marketingApi, type MarketingCall, type MarketingLead } from '../services/api';
import { operationsApi, type AutomationAction, type AutomationRule } from '../services/operations';
import '../strategic-platform.css';

type GoogleProvider = 'google_ads' | 'ga4';
type GoogleConfig = { provider: GoogleProvider; configured: boolean; status: string; values: Record<string, string>; secretFields: Record<string, boolean>; updatedAt?: string | null; lastVerifiedAt?: string | null; lastError?: string | null };
type AutomationRun = { id: string; rule_id: string; event_key: string; subject_id?: string | null; status: string; action_results?: unknown[]; error?: string | null; started_at: string; finished_at?: string | null };
type WebAnalyticsRow = { report_date: string; source: string; medium: string; campaign: string; users: number; sessions: number; key_events: number; revenue: number };

const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');

function Head({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <div className="strategic-head"><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: body }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload as T;
}

export function GoogleIntegrationsPage() {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<GoogleConfig[]>([]);
  const [web, setWeb] = useState<WebAnalyticsRow[]>([]);
  const [forms, setForms] = useState<Record<GoogleProvider, Record<string, string>>>({ google_ads: { apiVersion: 'v25' }, ga4: {} });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const load = async () => {
    setMessage(null);
    try {
      const result = await fetchJson<{ providers: GoogleConfig[] }>('/api/integrations/google/config');
      setConfigs(result.providers || []);
      setForms((previous) => {
        const next = { ...previous, google_ads: { ...previous.google_ads }, ga4: { ...previous.ga4 } };
        for (const config of result.providers || []) next[config.provider] = { ...next[config.provider], ...config.values };
        return next;
      });
      const rows = await fetchJson<WebAnalyticsRow[]>('/api/web-analytics').catch(() => []);
      setWeb(rows);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось загрузить Google интеграции'); }
  };
  useEffect(() => { if (user.role === 'administrator') void load(); }, [user.role]);

  const save = async (provider: GoogleProvider) => {
    setBusy(`save:${provider}`); setMessage(null);
    try {
      await fetchJson(`/api/integrations/google/config/${provider}`, { method: 'PUT', body: JSON.stringify(forms[provider]) });
      setMessage(`${provider === 'google_ads' ? 'Google Ads' : 'GA4'}: настройки сохранены.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка сохранения'); }
    finally { setBusy(null); }
  };
  const sync = async (provider: GoogleProvider) => {
    setBusy(`sync:${provider}`); setMessage(null);
    try {
      const result = await fetchJson<{ fetched: number; written: number }>(`/api/integrations/google/sync/${provider}`, { method: 'POST', body: JSON.stringify({ days }) });
      setMessage(`${provider === 'google_ads' ? 'Google Ads' : 'GA4'}: получено ${result.fetched}, записано ${result.written}.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка синхронизации'); }
    finally { setBusy(null); }
  };
  const field = (provider: GoogleProvider, name: string, value: string) => setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [name]: value } }));
  const status = (provider: GoogleProvider) => configs.find((item) => item.provider === provider);
  const totals = useMemo(() => web.reduce((acc, row) => ({ users: acc.users + Number(row.users || 0), sessions: acc.sessions + Number(row.sessions || 0), events: acc.events + Number(row.key_events || 0), revenue: acc.revenue + Number(row.revenue || 0) }), { users: 0, sessions: 0, events: 0, revenue: 0 }), [web]);

  if (user.role !== 'administrator') return <div className="strategic-page"><Head eyebrow="Google Platform" title="Google Ads + GA4" text="Настройки подключения доступны только администратору."/></div>;
  return <div className="strategic-page">
    <Head eyebrow="Google Marketing Platform" title="Google Ads + GA4" text="Серверное подключение через OAuth refresh token. Google Ads пишет рекламу в общий ads-контур, GA4 — в отдельную web analytics модель." action={<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option><option value={365}>365 дней</option></select>}/>
    {message && <div className="alert">{message}</div>}
    <div className="strategic-status"><article><span>GA4 пользователи</span><strong>{number(totals.users)}</strong></article><article><span>GA4 сессии</span><strong>{number(totals.sessions)}</strong></article><article><span>GA4 выручка</span><strong>{money(totals.revenue)}</strong></article></div>
    <div className="strategic-grid strategic-grid--equal">
      <section className="panel strategic-form google-card"><div className="google-card-head"><div><h2>Google Ads</h2><p>Расходы, клики, показы, conversions и conversion value.</p></div><b>{status('google_ads')?.status || 'not_configured'}</b></div>
        <label>OAuth Client ID<input value={forms.google_ads.clientId || ''} onChange={(e)=>field('google_ads','clientId',e.target.value)}/></label>
        <label>OAuth Client Secret<input type="password" value={forms.google_ads.clientSecret || ''} placeholder={status('google_ads')?.secretFields.clientSecret?'Сохранён · оставьте пустым':'Обязательное поле'} onChange={(e)=>field('google_ads','clientSecret',e.target.value)}/></label>
        <label>Refresh token<input type="password" value={forms.google_ads.refreshToken || ''} placeholder={status('google_ads')?.secretFields.refreshToken?'Сохранён · оставьте пустым':'Обязательное поле'} onChange={(e)=>field('google_ads','refreshToken',e.target.value)}/></label>
        <label>Developer token<input type="password" value={forms.google_ads.developerToken || ''} placeholder={status('google_ads')?.secretFields.developerToken?'Сохранён · оставьте пустым':'Обязательное поле'} onChange={(e)=>field('google_ads','developerToken',e.target.value)}/></label>
        <label>Customer IDs<input value={forms.google_ads.customerIds || ''} placeholder="1234567890, 9876543210" onChange={(e)=>field('google_ads','customerIds',e.target.value)}/></label>
        <label>Manager / Login Customer ID<input value={forms.google_ads.loginCustomerId || ''} placeholder="Необязательно" onChange={(e)=>field('google_ads','loginCustomerId',e.target.value)}/></label>
        <label>API version<input value={forms.google_ads.apiVersion || 'v25'} onChange={(e)=>field('google_ads','apiVersion',e.target.value)}/></label>
        {status('google_ads')?.lastError && <div className="alert alert--error">{status('google_ads')?.lastError}</div>}
        <div className="strategic-actions"><button className="button" onClick={()=>void save('google_ads')} disabled={Boolean(busy)}><Save size={15}/>Сохранить</button><button className="button button--primary" onClick={()=>void sync('google_ads')} disabled={Boolean(busy)}><RefreshCw size={15}/>Синхронизировать</button></div>
      </section>
      <section className="panel strategic-form google-card"><div className="google-card-head"><div><h2>Google Analytics 4</h2><p>Traffic acquisition: источник, medium, кампания, users, sessions, key events и revenue.</p></div><b>{status('ga4')?.status || 'not_configured'}</b></div>
        <label>OAuth Client ID<input value={forms.ga4.clientId || ''} onChange={(e)=>field('ga4','clientId',e.target.value)}/></label>
        <label>OAuth Client Secret<input type="password" value={forms.ga4.clientSecret || ''} placeholder={status('ga4')?.secretFields.clientSecret?'Сохранён · оставьте пустым':'Обязательное поле'} onChange={(e)=>field('ga4','clientSecret',e.target.value)}/></label>
        <label>Refresh token<input type="password" value={forms.ga4.refreshToken || ''} placeholder={status('ga4')?.secretFields.refreshToken?'Сохранён · оставьте пустым':'Обязательное поле'} onChange={(e)=>field('ga4','refreshToken',e.target.value)}/></label>
        <label>Property IDs<input value={forms.ga4.propertyIds || ''} placeholder="123456789, 987654321" onChange={(e)=>field('ga4','propertyIds',e.target.value)}/></label>
        {status('ga4')?.lastError && <div className="alert alert--error">{status('ga4')?.lastError}</div>}
        <div className="strategic-actions"><button className="button" onClick={()=>void save('ga4')} disabled={Boolean(busy)}><Save size={15}/>Сохранить</button><button className="button button--primary" onClick={()=>void sync('ga4')} disabled={Boolean(busy)}><RefreshCw size={15}/>Синхронизировать</button></div>
      </section>
    </div>
  </div>;
}

export function Customer360Page() {
  const [leads, setLeads] = useState<MarketingLead[]>([]); const [calls, setCalls] = useState<MarketingCall[]>([]); const [selected, setSelected] = useState(''); const [loading,setLoading]=useState(true); const [message,setMessage]=useState<string|null>(null);
  const load=async()=>{setLoading(true);setMessage(null);try{const [a,b]=await Promise.all([marketingApi.listLeads({limit:500}),marketingApi.calls({limit:500})]);setLeads(a);setCalls(b);}catch(error){setMessage(error instanceof Error?error.message:'Ошибка загрузки Customer 360');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const customers=useMemo(()=>{const map=new Map<string,MarketingLead[]>();for(const lead of leads){const phone=normalizePhone(lead.phone);const key=phone||lead.email?.trim().toLowerCase()||lead.id;map.set(key,[...(map.get(key)||[]),lead]);}return Array.from(map.entries()).map(([key,items])=>{const ordered=[...items].sort((a,b)=>new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime());const latest=ordered[0];return{key,latest,items,revenue:items.reduce((sum,item)=>sum+Number(item.sale_amount||0),0)};}).sort((a,b)=>b.revenue-a.revenue||new Date(b.latest.updated_at).getTime()-new Date(a.latest.updated_at).getTime());},[leads]);
  useEffect(()=>{if(!selected&&customers[0])setSelected(customers[0].key);},[customers,selected]);
  const current=customers.find(item=>item.key===selected)||customers[0];
  const relatedCalls=useMemo(()=>current?calls.filter(call=>normalizePhone(call.client_phone)===normalizePhone(current.latest.phone)||current.items.some(lead=>lead.id===call.lead_id)):[],[calls,current]);
  const timeline=useMemo(()=>{if(!current)return[];const rows=[...current.items.map(lead=>({date:lead.lead_created_at||lead.created_at,title:`Лид · ${lead.stage}`,text:`${lead.source||lead.platform||'Источник не указан'}${lead.campaign?` · ${lead.campaign}`:''}`})),...relatedCalls.map(call=>({date:call.started_at,title:`Звонок · ${call.call_result||call.call_status||'без результата'}`,text:`${call.operator_name||'Оператор не указан'} · ${Math.round(Number(call.duration_seconds||0)/60)} мин${call.appointment_created?' · создана запись':''}`}))];return rows.sort((a,b)=>new Date(b.date||0).getTime()-new Date(a.date||0).getTime()).slice(0,50);},[current,relatedCalls]);
  return <div className="strategic-page"><Head eyebrow="CRM / Customer 360" title="Клиенты 360°" text="Единый профиль клиента на основе CRM-лидов и звонков: история касаний, источники, стадии, продажи и ответственные." action={<button className="button" onClick={()=>void load()}><RefreshCw size={15}/>Обновить</button>}/>{message&&<div className="alert alert--error">{message}</div>}
    {loading?<div className="suite-state">Загружаем клиентскую историю…</div>:<div className="customer-layout"><section className="panel"><div className="customer-list">{customers.map(customer=><button key={customer.key} className={`customer-row ${current?.key===customer.key?'active':''}`} onClick={()=>setSelected(customer.key)}><div><b>{customer.latest.name||customer.latest.phone||'Без имени'}</b><small>{customer.latest.phone||customer.latest.email||'Нет контакта'} · {customer.latest.stage}</small></div><strong>{money(customer.revenue)}</strong></button>)}</div></section>
      <section className="panel customer-profile">{current&&<><div className="customer-profile-head"><div><h2>{current.latest.name}</h2><p>{current.latest.phone||'—'} · {current.latest.email||'email не указан'}</p></div><span className="badge">{current.latest.stage}</span></div><div className="customer-facts"><div><span>Лидов</span><b>{current.items.length}</b></div><div><span>Звонков</span><b>{relatedCalls.length}</b></div><div><span>Выручка</span><b>{money(current.revenue)}</b></div><div><span>Менеджер</span><b>{current.latest.manager||'Не назначен'}</b></div></div><div className="customer-facts"><div><span>Первый источник</span><b>{[...current.items].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime())[0]?.source||'—'}</b></div><div><span>Последний источник</span><b>{current.latest.source||current.latest.platform||'—'}</b></div><div><span>UTM campaign</span><b>{current.latest.utm_campaign||'—'}</b></div><div><span>Продаж</span><b>{current.items.filter(item=>Number(item.sale_amount||0)>0||Boolean(item.sold_at)).length}</b></div></div><div><h3>История касаний</h3><div className="timeline">{timeline.map((item,index)=><div className="timeline-item" key={`${item.date}-${index}`}><i/><div><b>{item.title}</b><p>{item.text} · {item.date?new Date(item.date).toLocaleString('ru-RU'):'—'}</p></div></div>)}</div></div></>}</section></div>}
  </div>;
}

export function MarketingAiPage() {
  const [question,setQuestion]=useState('Почему меняется эффективность маркетинга и что проверить в первую очередь?'); const [answer,setAnswer]=useState(''); const [loading,setLoading]=useState(false); const [message,setMessage]=useState<string|null>(null);
  const ask=async()=>{if(!question.trim())return;setLoading(true);setMessage(null);try{const result=await fetchJson<{answer:string}>('/api/assistant/marketing',{method:'POST',body:JSON.stringify({question})});setAnswer(result.answer);}catch(error){setMessage(error instanceof Error?error.message:'AI недоступен');}finally{setLoading(false);}};
  const prompts=['Почему вырос CPL?','Какие кампании требуют внимания?','Где теряются лиды в воронке?','Какие проблемы качества данных влияют на аналитику?','Что делать маркетологу сегодня?'];
  return <div className="strategic-page"><Head eyebrow="IMDS Intelligence" title="AI Marketing Assistant" text="AI анализирует агрегированные показатели IMDS Marketing: воронку, источники, рекламу, web analytics, качество данных и состояние интеграций."/>{message&&<div className="alert alert--error">{message}</div>}<div className="ai-shell"><section className="panel strategic-form"><Bot size={28}/><label>Вопрос<textarea value={question} onChange={e=>setQuestion(e.target.value)}/></label><div className="ai-prompts">{prompts.map(prompt=><button key={prompt} onClick={()=>setQuestion(prompt)}>{prompt}</button>)}</div><button className="button button--primary" onClick={()=>void ask()} disabled={loading}><Bot size={15}/>{loading?'Анализируем…':'Спросить IMDS AI'}</button><div className="strategic-note">API-ключ хранится только на сервере. В модель передаются агрегированные маркетинговые показатели без имён и телефонов клиентов.</div></section><section className="panel ai-answer">{answer||'Ответ IMDS AI появится здесь.'}</section></div></div>;
}

export function JourneyAutomationPage() {
  const [rules,setRules]=useState<AutomationRule[]>([]);const [runs,setRuns]=useState<AutomationRun[]>([]);const [message,setMessage]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({name:'',triggerType:'lead_created',source:'',stage:'',actionType:'create_task',title:'Обработать лид {{name}}',targetStage:'',webhookUrl:''});
  const load=async()=>{try{const [a,b]=await Promise.all([operationsApi.automations.list(),fetchJson<AutomationRun[]>('/api/automation/runs')]);setRules(a);setRuns(b);}catch(error){setMessage(error instanceof Error?error.message:'Ошибка загрузки Journey Automation');}};
  useEffect(()=>{void load();},[]);
  const create=async()=>{if(!form.name.trim())return;setBusy(true);setMessage(null);const triggerConfig:Record<string,unknown>={};if(form.triggerType==='lead_created'&&form.source.trim())triggerConfig.source=form.source.trim();if(form.triggerType==='lead_stage')triggerConfig.stage=form.stage.trim();let action:AutomationAction;if(form.actionType==='update_lead_stage')action={type:'update_lead_stage',stage:form.targetStage.trim()};else if(form.actionType==='webhook')action={type:'webhook',url:form.webhookUrl.trim()};else action={type:'create_task',title:form.title.trim()||'Обработать лид {{name}}',priority:'Средний',dueDays:0};const triggerText=form.triggerType==='lead_created'?`Новый лид${form.source?` · источник ${form.source}`:''}`:form.triggerType==='lead_stage'?`Лид перешёл на стадию ${form.stage}`:'Лид без ответственного';const actionText=form.actionType==='create_task'?`Создать задачу: ${form.title}`:form.actionType==='update_lead_stage'?`Изменить стадию на ${form.targetStage}`:`POST webhook ${form.webhookUrl}`;try{setRules(await operationsApi.automations.create({name:form.name,enabled:true,trigger_text:triggerText,action_text:actionText,trigger_type:form.triggerType,trigger_config:triggerConfig,actions:[action]}));setForm({...form,name:''});await load();}catch(error){setMessage(error instanceof Error?error.message:'Не удалось создать journey');}finally{setBusy(false);}};
  const toggle=async(rule:AutomationRule)=>{try{setRules(await operationsApi.automations.update(rule.id,{enabled:!rule.enabled}));}catch(error){setMessage(error instanceof Error?error.message:'Не удалось обновить journey');}};
  const execute=async()=>{setBusy(true);setMessage(null);try{const result=await fetchJson<{matched:number;executed:number;failed:number}>('/api/automation/execute',{method:'POST',body:'{}'});setMessage(`Проверка завершена: совпадений ${result.matched}, выполнено ${result.executed}, ошибок ${result.failed}.`);await load();}catch(error){setMessage(error instanceof Error?error.message:'Ошибка выполнения');}finally{setBusy(false);}};
  const executable=rules.filter(rule=>rule.trigger_type&&Array.isArray(rule.actions)&&rule.actions.length>0);
  return <div className="strategic-page"><Head eyebrow="Journey Automation" title="Automation Engine" text="Исполняемые сценарии на CRM-событиях. Engine работает по расписанию и поддерживает идемпотентный журнал запусков." action={<button className="button button--primary" onClick={()=>void execute()} disabled={busy}><Play size={15}/>Запустить сейчас</button>}/>{message&&<div className="alert">{message}</div>}<div className="strategic-grid"><section className="panel strategic-form"><h2>Новый Journey</h2><label>Название<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Триггер<select value={form.triggerType} onChange={e=>setForm({...form,triggerType:e.target.value})}><option value="lead_created">Новый лид</option><option value="lead_stage">Стадия лида</option><option value="unassigned_lead">Лид без менеджера</option></select></label>{form.triggerType==='lead_created'&&<label>Фильтр по источнику<input value={form.source} placeholder="Например Instagram" onChange={e=>setForm({...form,source:e.target.value})}/></label>}{form.triggerType==='lead_stage'&&<label>Стадия<input value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}/></label>}<label>Действие<select value={form.actionType} onChange={e=>setForm({...form,actionType:e.target.value})}><option value="create_task">Создать задачу</option><option value="update_lead_stage">Изменить стадию</option><option value="webhook">HTTPS Webhook</option></select></label>{form.actionType==='create_task'&&<label>Название задачи<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>}{form.actionType==='update_lead_stage'&&<label>Новая стадия<input value={form.targetStage} onChange={e=>setForm({...form,targetStage:e.target.value})}/></label>}{form.actionType==='webhook'&&<label>Webhook URL<input value={form.webhookUrl} placeholder="https://..." onChange={e=>setForm({...form,webhookUrl:e.target.value})}/></label>}<button className="button" onClick={()=>void create()} disabled={busy}><Save size={15}/>Создать Journey</button></section><section className="panel"><h2>Исполняемые сценарии</h2><div className="journey-list">{executable.length===0?<p className="muted">Исполняемых Journey пока нет.</p>:executable.map(rule=><article className="journey-card" key={rule.id}><div><h3>{rule.name}</h3><p>{rule.trigger_text}</p><div className="journey-flow"><span className="journey-node">{rule.trigger_type}</span><span>→</span><span className="journey-node">{rule.actions?.map(a=>a.type).join(' → ')}</span></div></div><button className={rule.enabled?'status-pill status-pill--ok':'status-pill'} onClick={()=>void toggle(rule)}>{rule.enabled?'Включено':'Выключено'}</button></article>)}</div></section></div><section className="panel"><div className="strategic-head"><div><h2>Журнал выполнений</h2><p>Последние 200 событий Automation Engine.</p></div><button className="button" onClick={()=>void load()}><RefreshCw size={15}/>Обновить</button></div><div className="run-list">{runs.map(run=><div className="run-item" key={run.id}><i className={`run-dot ${run.status}`}/><div><b>{run.event_key}</b><small>{run.error||`Rule ${run.rule_id}`}</small></div><small>{run.status} · {new Date(run.started_at).toLocaleString('ru-RU')}</small></div>)}</div></section></div>;
}
