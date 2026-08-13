import { useEffect,useMemo,useState } from 'react';
import { CalendarDays,ChevronLeft,ChevronRight,GitBranch,Link2,RefreshCw,Repeat2,Trash2 } from 'lucide-react';
import { tasksApi,type TaskCalendarItem,type TaskDependency,type TaskRecurrenceRule,type WorkTask } from '../services/tasks';

type Props={mode:'calendar'|'relations'};
const statusLabel:Record<string,string>={todo:'Новая',in_progress:'В работе',review:'На проверке',done:'Выполнена',cancelled:'Отменена'};
const priorityLabel:Record<string,string>={low:'Низкий',medium:'Обычный',high:'Высокий',urgent:'Срочный'};
const workflowLabel:Record<string,string>={general:'Общие задачи',call_center:'Колл-центр',marketing:'Маркетинг',content:'Контент'};
const ymd=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const localInput=(date:Date)=>{const offset=date.getTimezoneOffset()*60000;return new Date(date.getTime()-offset).toISOString().slice(0,16);};

export default function TaskPhase2Workspace({mode}:Props){
  return mode==='calendar'?<TaskCalendar/>:<TaskRelations/>;
}

function TaskCalendar(){
  const [month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const [items,setItems]=useState<TaskCalendarItem[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);
  const range=useMemo(()=>{const from=new Date(month.getFullYear(),month.getMonth(),1);const to=new Date(month.getFullYear(),month.getMonth()+1,0,23,59,59,999);return{from,to};},[month]);
  const load=async()=>{setLoading(true);setError(null);try{const result=await tasksApi.calendar(range.from.toISOString(),range.to.toISOString());setItems(result.items);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setLoading(false);}};
  useEffect(()=>{void load();},[range.from.getTime(),range.to.getTime()]);
  const firstOffset=(new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7;const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();const cells=Array.from({length:firstOffset+days},(_,i)=>i<firstOffset?null:i-firstOffset+1);
  const byDay=useMemo(()=>{const map=new Map<string,TaskCalendarItem[]>();for(const item of items){const key=ymd(new Date(item.dueAt));map.set(key,[...(map.get(key)||[]),item]);}return map;},[items]);
  return <section className="task-phase-workspace">
    <header className="task-phase-heading"><div><span><CalendarDays size={17}/> ПЛАН РАБОТ</span><h1>Календарь задач</h1><p>Все дедлайны по процессам в одном месяце.</p></div><div className="task-month-nav"><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft/></button><strong>{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</strong><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight/></button><button onClick={()=>void load()} title="Обновить"><RefreshCw size={16}/></button></div></header>
    {error&&<div className="tasks-error">{error}</div>}
    {loading?<div className="tasks-empty">Загрузка календаря…</div>:<div className="task-calendar-grid">
      {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=><div className="task-calendar-weekday" key={day}>{day}</div>)}
      {cells.map((day,index)=>day===null?<div className="task-calendar-cell empty" key={`e${index}`}/>:<div className={`task-calendar-cell ${ymd(new Date())===ymd(new Date(month.getFullYear(),month.getMonth(),day))?'today':''}`} key={day}><b>{day}</b><div className="task-calendar-items">{(byDay.get(ymd(new Date(month.getFullYear(),month.getMonth(),day)))||[]).slice(0,6).map(item=><article key={item.id} className={`priority-${item.priority}`}><span>{new Date(item.dueAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span><strong>{item.title}</strong><small>{workflowLabel[item.workflowKey]||item.workflowKey} · {statusLabel[item.status]||item.status}</small></article>)}</div>{(byDay.get(ymd(new Date(month.getFullYear(),month.getMonth(),day)))||[]).length>6&&<small className="task-calendar-more">+ ещё {(byDay.get(ymd(new Date(month.getFullYear(),month.getMonth(),day)))||[]).length-6}</small>}</div>)}
    </div>}
  </section>;
}

function TaskRelations(){
  const [tasks,setTasks]=useState<WorkTask[]>([]);const [selectedId,setSelectedId]=useState('');const [dependencies,setDependencies]=useState<TaskDependency[]>([]);const [recurrence,setRecurrence]=useState<TaskRecurrenceRule|null>(null);const [dependencyId,setDependencyId]=useState('');const [frequency,setFrequency]=useState<'daily'|'weekly'|'monthly'>('weekly');const [intervalCount,setIntervalCount]=useState(1);const [nextRunAt,setNextRunAt]=useState(()=>localInput(new Date(Date.now()+86400000)));const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const selected=tasks.find(t=>t.id===selectedId);
  const loadTasks=async()=>{setError(null);try{const result=await tasksApi.list('all','');setTasks(result.tasks);if(!selectedId&&result.tasks[0])setSelectedId(result.tasks[0].id);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}};
  const loadDetails=async(id:string)=>{if(!id)return;setError(null);try{const [deps,rec]=await Promise.all([tasksApi.dependencies(id),tasksApi.recurrence(id)]);setDependencies(deps.dependencies);setRecurrence(rec.rule);if(rec.rule){setFrequency(rec.rule.frequency);setIntervalCount(rec.rule.intervalCount);setNextRunAt(localInput(new Date(rec.rule.nextRunAt)));}}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}};
  useEffect(()=>{void loadTasks();},[]);useEffect(()=>{void loadDetails(selectedId);},[selectedId]);
  const addDependency=async()=>{if(!selectedId||!dependencyId)return;setBusy(true);setError(null);try{await tasksApi.addDependency(selectedId,dependencyId);setDependencyId('');await loadDetails(selectedId);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  const saveRecurrence=async()=>{if(!selectedId)return;setBusy(true);setError(null);try{await tasksApi.setRecurrence(selectedId,{frequency,intervalCount,nextRunAt:new Date(nextRunAt).toISOString()});await loadDetails(selectedId);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  const stopRecurrence=async()=>{if(!selectedId)return;setBusy(true);try{await tasksApi.stopRecurrence(selectedId);await loadDetails(selectedId);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  return <section className="task-phase-workspace">
    <header className="task-phase-heading"><div><span><GitBranch size={17}/> TASK ORCHESTRATION</span><h1>Связи и повторы</h1><p>Задачи могут блокировать друг друга и автоматически повторяться по расписанию.</p></div></header>
    {error&&<div className="tasks-error">{error}</div>}
    <label className="task-phase-task-select">Задача<select value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">Выберите задачу</option>{tasks.map(task=><option key={task.id} value={task.id}>{task.title} · {statusLabel[task.status]}</option>)}</select></label>
    {selected&&<div className="task-phase-columns">
      <section className="task-phase-card"><header><div><Link2 size={18}/><h2>Зависимости</h2></div><small>Эту задачу нельзя завершить, пока блокирующие задачи не выполнены.</small></header><div className="task-dependency-list">{dependencies.length?dependencies.map(dep=><article key={dep.id}><div><strong>{dep.title}</strong><span>{statusLabel[dep.status]||dep.status} · {priorityLabel[dep.priority]||dep.priority}</span></div><button disabled={busy} onClick={async()=>{setBusy(true);try{await tasksApi.deleteDependency(selectedId,dep.id);await loadDetails(selectedId);}finally{setBusy(false);}}}><Trash2 size={15}/></button></article>):<div className="task-empty-state">Нет блокирующих задач.</div>}</div><div className="task-phase-inline"><select value={dependencyId} onChange={e=>setDependencyId(e.target.value)}><option value="">Добавить блокирующую задачу…</option>{tasks.filter(t=>t.id!==selectedId&&!dependencies.some(d=>d.taskId===t.id)).map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select><button className="button button--primary" disabled={!dependencyId||busy} onClick={()=>void addDependency()}>Связать</button></div></section>
      <section className="task-phase-card"><header><div><Repeat2 size={18}/><h2>Повторение</h2></div><small>Следующий экземпляр создаст Worker и сохранит исполнителей, чек-лист и связь с объектом.</small></header><div className="task-recurrence-form"><label>Период<select value={frequency} onChange={e=>setFrequency(e.target.value as 'daily'|'weekly'|'monthly')}><option value="daily">Каждый день</option><option value="weekly">Каждую неделю</option><option value="monthly">Каждый месяц</option></select></label><label>Интервал<input type="number" min="1" max="365" value={intervalCount} onChange={e=>setIntervalCount(Math.max(1,Number(e.target.value)||1))}/></label><label>Следующий запуск<input type="datetime-local" value={nextRunAt} onChange={e=>setNextRunAt(e.target.value)}/></label></div>{recurrence&&<div className="task-recurrence-status"><span className={recurrence.enabled?'active':''}/><div><strong>{recurrence.enabled?'Повторение включено':'Повторение остановлено'}</strong><small>Следующий: {new Date(recurrence.nextRunAt).toLocaleString('ru-RU')}</small></div></div>}<footer><button className="button button--primary" disabled={busy||!nextRunAt} onClick={()=>void saveRecurrence()}>{recurrence?'Обновить':'Включить повторение'}</button>{recurrence?.enabled&&<button className="button" disabled={busy} onClick={()=>void stopRecurrence()}>Остановить</button>}</footer></section>
    </div>}
  </section>;
}
