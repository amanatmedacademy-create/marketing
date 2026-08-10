import { useEffect, useMemo, useState } from 'react';
import { Play, RefreshCw, Save } from 'lucide-react';
import { operationsApi, type AutomationAction, type AutomationRule } from '../services/operations';
import '../strategic-platform.css';

type AutomationRun = { id:string; rule_id:string; event_key:string; subject_id?:string|null; status:string; action_results?:unknown[]; error?:string|null; started_at:string; finished_at?:string|null };

type FormState = { name:string; triggerType:string; source:string; stage:string; actionType:string; title:string; targetStage:string; webhookUrl:string };
const initialForm:FormState={name:'',triggerType:'lead_created',source:'',stage:'',actionType:'create_task',title:'Обработать лид {{name}}',targetStage:'',webhookUrl:''};

async function fetchJson<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(path,{...init,headers:{'content-type':'application/json',...init?.headers}});
  const body=await response.text(); let payload:unknown={};
  try{payload=body?JSON.parse(body):{};}catch{payload={error:body};}
  if(!response.ok)throw new Error((payload as {error?:string}).error||`HTTP ${response.status}`);
  return payload as T;
}

function validate(form:FormState):string|null{
  if(!form.name.trim())return 'Укажите название Journey.';
  if(form.triggerType==='lead_stage'&&!form.stage.trim())return 'Для триггера по стадии укажите исходную стадию.';
  if(form.actionType==='create_task'&&!form.title.trim())return 'Укажите название создаваемой задачи.';
  if(form.actionType==='update_lead_stage'&&!form.targetStage.trim())return 'Укажите новую стадию.';
  if(form.actionType==='webhook'){
    try{const url=new URL(form.webhookUrl);if(url.protocol!=='https:')return 'Webhook должен использовать HTTPS.';}
    catch{return 'Укажите корректный HTTPS webhook URL.';}
  }
  return null;
}

export default function JourneyAutomationPage(){
  const [rules,setRules]=useState<AutomationRule[]>([]);
  const [runs,setRuns]=useState<AutomationRun[]>([]);
  const [message,setMessage]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [busyRuleId,setBusyRuleId]=useState('');
  const [form,setForm]=useState<FormState>(initialForm);

  const load=async(showLoading=true)=>{if(showLoading)setLoading(true);try{const [a,b]=await Promise.all([operationsApi.automations.list(),fetchJson<AutomationRun[]>('/api/automation/runs')]);setRules(a);setRuns(b);}catch(error){setMessage(error instanceof Error?error.message:'Ошибка загрузки Journey Automation');}finally{if(showLoading)setLoading(false);}};
  useEffect(()=>{void load();},[]);

  const validationError=useMemo(()=>validate(form),[form]);
  const create=async()=>{
    const invalid=validate(form); if(invalid){setMessage(invalid);return;}
    setBusy(true);setMessage(null);
    const triggerConfig:Record<string,unknown>={};
    if(form.triggerType==='lead_created'&&form.source.trim())triggerConfig.source=form.source.trim();
    if(form.triggerType==='lead_stage')triggerConfig.stage=form.stage.trim();
    let action:AutomationAction;
    if(form.actionType==='update_lead_stage')action={type:'update_lead_stage',stage:form.targetStage.trim()};
    else if(form.actionType==='webhook')action={type:'webhook',url:form.webhookUrl.trim()};
    else action={type:'create_task',title:form.title.trim(),priority:'Средний',dueDays:0};
    const triggerText=form.triggerType==='lead_created'?`Новый лид${form.source.trim()?` · источник ${form.source.trim()}`:''}`:form.triggerType==='lead_stage'?`Лид перешёл на стадию ${form.stage.trim()}`:'Лид без менеджера';
    const actionText=form.actionType==='create_task'?`Создать задачу: ${form.title.trim()}`:form.actionType==='update_lead_stage'?`Изменить стадию на ${form.targetStage.trim()}`:`POST webhook ${form.webhookUrl.trim()}`;
    try{
      await operationsApi.automations.create({name:form.name.trim(),enabled:true,trigger_text:triggerText,action_text:actionText,trigger_type:form.triggerType,trigger_config:triggerConfig,actions:[action]});
      setForm(initialForm); setMessage('Journey создан.'); await load(false);
    }catch(error){setMessage(error instanceof Error?error.message:'Не удалось создать Journey');}
    finally{setBusy(false);}
  };

  const toggle=async(rule:AutomationRule)=>{
    if(busyRuleId)return; setBusyRuleId(rule.id);setMessage(null);
    try{await operationsApi.automations.update(rule.id,{enabled:!rule.enabled});await load(false);}
    catch(error){setMessage(error instanceof Error?error.message:'Не удалось обновить Journey');}
    finally{setBusyRuleId('');}
  };
  const execute=async()=>{setBusy(true);setMessage(null);try{const result=await fetchJson<{matched:number;executed:number;failed:number}>('/api/automation/execute',{method:'POST',body:'{}'});setMessage(`Проверка завершена: совпадений ${result.matched}, выполнено ${result.executed}, ошибок ${result.failed}.`);await load(false);}catch(error){setMessage(error instanceof Error?error.message:'Ошибка выполнения');}finally{setBusy(false);}};
  const executable=rules.filter(rule=>rule.trigger_type&&Array.isArray(rule.actions)&&rule.actions.length>0);

  return <div className="strategic-page">
    <div className="strategic-head"><div><span>Journey Automation</span><h1>Automation Engine</h1><p>Исполняемые сценарии с обязательной проверкой триггеров и действий перед сохранением.</p></div><button className="button button--primary" onClick={()=>void execute()} disabled={busy||loading}><Play size={15}/>{busy?'Выполнение…':'Запустить сейчас'}</button></div>
    {message&&<div className="alert">{message}</div>}
    {loading?<div className="suite-state">Загружаем Journey…</div>:<><div className="strategic-grid"><section className="panel strategic-form"><h2>Новый Journey</h2>
      <label>Название<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Триггер<select value={form.triggerType} onChange={e=>setForm({...form,triggerType:e.target.value})}><option value="lead_created">Новый лид</option><option value="lead_stage">Стадия лида</option><option value="unassigned_lead">Лид без менеджера</option></select></label>
      {form.triggerType==='lead_created'&&<label>Фильтр по источнику<input value={form.source} placeholder="Например Instagram" onChange={e=>setForm({...form,source:e.target.value})}/></label>}
      {form.triggerType==='lead_stage'&&<label>Стадия *<input value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}/></label>}
      <label>Действие<select value={form.actionType} onChange={e=>setForm({...form,actionType:e.target.value})}><option value="create_task">Создать задачу</option><option value="update_lead_stage">Изменить стадию</option><option value="webhook">HTTPS Webhook</option></select></label>
      {form.actionType==='create_task'&&<label>Название задачи *<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>}
      {form.actionType==='update_lead_stage'&&<label>Новая стадия *<input value={form.targetStage} onChange={e=>setForm({...form,targetStage:e.target.value})}/></label>}
      {form.actionType==='webhook'&&<label>Webhook URL *<input value={form.webhookUrl} placeholder="https://..." onChange={e=>setForm({...form,webhookUrl:e.target.value})}/></label>}
      {validationError&&<small>{validationError}</small>}
      <button className="button" onClick={()=>void create()} disabled={busy||Boolean(validationError)}><Save size={15}/>{busy?'Сохранение…':'Создать Journey'}</button>
    </section><section className="panel"><h2>Исполняемые сценарии</h2><div className="journey-list">{executable.length===0?<p className="muted">Исполняемых Journey пока нет.</p>:executable.map(rule=><article className="journey-card" key={rule.id}><div><h3>{rule.name}</h3><p>{rule.trigger_text}</p><div className="journey-flow"><span className="journey-node">{rule.trigger_type}</span><span>→</span><span className="journey-node">{rule.actions?.map(a=>a.type).join(' → ')}</span></div></div><button disabled={Boolean(busyRuleId)} className={rule.enabled?'status-pill status-pill--ok':'status-pill'} onClick={()=>void toggle(rule)}>{busyRuleId===rule.id?'Сохранение…':rule.enabled?'Включено':'Выключено'}</button></article>)}</div></section></div>
    <section className="panel"><div className="strategic-head"><div><h2>Журнал выполнений</h2><p>Последние события Automation Engine.</p></div><button className="button" onClick={()=>void load(false)} disabled={loading||busy}><RefreshCw size={15}/>Обновить</button></div><div className="run-list">{runs.map(run=><div className="run-item" key={run.id}><div><b>{run.event_key}</b><small>{new Date(run.started_at).toLocaleString('ru-RU')}</small></div><span className={`status-pill ${run.status==='success'?'status-pill--ok':''}`}>{run.status}</span><small>{run.error||run.subject_id||'—'}</small></div>)}{!runs.length&&<p className="muted">Запусков пока нет.</p>}</div></section></>}
  </div>;
}
