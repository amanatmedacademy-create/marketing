import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDot, Clock3, ListChecks, MessageSquare, Plus, Search, Users, X } from 'lucide-react';
import { useAuth } from '../components/AuthGate';
import { tasksApi, type TaskAssignmentMode, type TaskGroup, type TaskPriority, type TaskStatus, type TaskTargetType, type TaskUser, type WorkTask } from '../services/tasks';
import '../tasks.css';

const statusLabels: Record<TaskStatus,string> = { todo:'Новая', in_progress:'В работе', review:'На проверке', done:'Выполнена', cancelled:'Отменена' };
const priorityLabels: Record<TaskPriority,string> = { low:'Низкий', medium:'Обычный', high:'Высокий', urgent:'Срочный' };
const scopes = [{id:'all',label:'Все задачи'},{id:'mine',label:'Мои задачи'},{id:'created',label:'Поставленные мной'},{id:'overdue',label:'Просроченные'},{id:'done',label:'Завершённые'}];

export default function TasksPage() {
  const { user } = useAuth();
  const [scope,setScope] = useState('all');
  const [tasks,setTasks] = useState<WorkTask[]>([]);
  const [users,setUsers] = useState<TaskUser[]>([]);
  const [groups,setGroups] = useState<TaskGroup[]>([]);
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState<WorkTask | null>(null);
  const [creating,setCreating] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [list,bootstrap] = await Promise.all([tasksApi.list(scope), tasksApi.bootstrap()]);
      setTasks(list.tasks); setUsers(bootstrap.users); setGroups(bootstrap.groups);
      if (selected) setSelected(list.tasks.find((item)=>item.id===selected.id) || null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(()=>{ void load(); },[scope]);

  const visible = useMemo(()=> {
    const needle=query.trim().toLowerCase(); if(!needle) return tasks;
    return tasks.filter((task)=>[task.title,task.description,task.createdByName,...task.targets.map((t)=>t.targetLabel)].filter(Boolean).join(' ').toLowerCase().includes(needle));
  },[tasks,query]);
  const overdueCount = tasks.filter((task)=>task.dueAt && new Date(task.dueAt)<new Date() && !['done','cancelled'].includes(task.status)).length;

  const changeStatus = async (task: WorkTask,status: TaskStatus) => {
    try {
      const response = task.assignmentMode==='individual'
        ? await tasksApi.updateExecution(task.id,status)
        : await tasksApi.update(task.id,{status});
      setTasks((current)=>current.map((item)=>item.id===task.id?response.task:item)); setSelected(response.task);
    } catch(reason){ setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <div className="tasks-page">
    <header className="tasks-hero">
      <div><span className="tasks-eyebrow"><ListChecks size={15}/> WORK MANAGEMENT</span><h1>Задачи</h1><p>Общие, отделовые и персональные задачи по текущей компании.</p></div>
      <button className="button button--primary" onClick={()=>setCreating(true)}><Plus size={17}/>Поставить задачу</button>
    </header>

    <section className="tasks-kpis">
      <article><span>Открытые</span><strong>{tasks.filter(t=>!['done','cancelled'].includes(t.status)).length}</strong></article>
      <article><span>Просроченные</span><strong>{overdueCount}</strong></article>
      <article><span>В работе</span><strong>{tasks.filter(t=>t.status==='in_progress').length}</strong></article>
      <article><span>Завершённые</span><strong>{tasks.filter(t=>t.status==='done').length}</strong></article>
    </section>

    <section className="tasks-toolbar">
      <div className="tasks-tabs">{scopes.map((item)=><button key={item.id} className={scope===item.id?'active':''} onClick={()=>setScope(item.id)}>{item.label}</button>)}</div>
      <label className="tasks-search"><Search size={16}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Поиск задач"/></label>
    </section>

    {error && <div className="tasks-error">{error}</div>}
    {loading ? <div className="tasks-empty">Загрузка задач…</div> : visible.length===0 ? <div className="tasks-empty">Задач пока нет.</div> : <section className="tasks-list">
      {visible.map((task)=>{
        const mine = task.executions.find((item)=>item.userId===user.id);
        const displayStatus = mine?.status || task.status;
        return <button className="task-card" key={task.id} onClick={()=>setSelected(task)}>
          <div className={`task-priority task-priority--${task.priority}`}>{priorityLabels[task.priority]}</div>
          <div className="task-main"><div className="task-title-row"><h3>{task.title}</h3><span className={`task-status task-status--${displayStatus}`}>{statusLabels[displayStatus]}</span></div>
          <p>{task.description || 'Без описания'}</p><div className="task-meta"><span><Users size={14}/>{task.targets.map(t=>t.targetLabel).join(', ')}</span><span><Clock3 size={14}/>{task.dueAt ? new Date(task.dueAt).toLocaleString('ru-RU') : 'Без срока'}</span><span>Постановщик: {task.createdByName || 'Система'}</span></div></div>
          <span className="task-progress">{task.assignmentMode==='individual' ? `${task.executions.filter(e=>e.status==='done').length}/${task.executions.length}` : 'Общая'}</span>
        </button>;
      })}
    </section>}

    {creating && <TaskCreateModal users={users} groups={groups} selfId={user.id} onClose={()=>setCreating(false)} onCreated={(task)=>{setTasks((c)=>[task,...c]);setCreating(false);setSelected(task);}}/>}
    {selected && <TaskDrawer task={selected} currentUserId={user.id} onClose={()=>setSelected(null)} onStatus={changeStatus} onUpdated={(task)=>{setSelected(task);setTasks((c)=>c.map((item)=>item.id===task.id?task:item));}}/>}
  </div>;
}

function TaskCreateModal({users,groups,selfId,onClose,onCreated}:{users:TaskUser[];groups:TaskGroup[];selfId:string;onClose:()=>void;onCreated:(task:WorkTask)=>void}){
  const [title,setTitle]=useState(''); const [description,setDescription]=useState(''); const [priority,setPriority]=useState<TaskPriority>('medium'); const [dueAt,setDueAt]=useState(''); const [mode,setMode]=useState<TaskAssignmentMode>('shared');
  const [targets,setTargets]=useState<Array<{targetType:TaskTargetType;targetValue?:string;targetLabel:string}>>([]); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
  const addTarget=(target:{targetType:TaskTargetType;targetValue?:string;targetLabel:string})=>setTargets((current)=>current.some((item)=>item.targetType===target.targetType&&item.targetValue===target.targetValue)?current:[...current,target]);
  const submit=async()=>{ if(!title.trim()||targets.length===0){setError('Укажите название и хотя бы одного адресата');return;} setBusy(true);setError(null); try{const result=await tasksApi.create({title:title.trim(),description:description.trim()||null,priority,dueAt:dueAt?new Date(dueAt).toISOString():null,assignmentMode:mode,targets});onCreated(result.task);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);} };
  return <div className="tasks-modal-backdrop"><section className="tasks-modal"><header><div><h2>Новая задача</h2><p>Назначьте всем, отделу, сотрудникам или себе.</p></div><button onClick={onClose}><X/></button></header>
    <label>Название<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Что нужно сделать?"/></label><label>Описание<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4}/></label>
    <div className="tasks-form-grid"><label>Приоритет<select value={priority} onChange={e=>setPriority(e.target.value as TaskPriority)}>{Object.entries(priorityLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Срок<input type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label></div>
    <div className="tasks-target-panel"><strong>Кому</strong><div className="tasks-target-actions"><button onClick={()=>addTarget({targetType:'all',targetLabel:'Всем сотрудникам'})}>Всем</button><button onClick={()=>addTarget({targetType:'user',targetValue:selfId,targetLabel:'Себе'})}>Себе</button></div>
      <div className="tasks-target-columns"><div><small>Отделы / должности</small>{groups.map(group=><button key={`${group.type}:${group.id}`} onClick={()=>addTarget({targetType:group.type,targetValue:group.id,targetLabel:group.name})}>{group.name}<span>{group.memberCount}</span></button>)}</div><div><small>Сотрудники</small>{users.map(item=><button key={item.id} onClick={()=>addTarget({targetType:'user',targetValue:item.id,targetLabel:item.name})}>{item.name}<span>{item.jobTitle||item.positionName||''}</span></button>)}</div></div>
      <div className="tasks-selected-targets">{targets.map((target,index)=><span key={`${target.targetType}:${target.targetValue||index}`}>{target.targetLabel}<button onClick={()=>setTargets((current)=>current.filter((_,i)=>i!==index))}>×</button></span>)}</div>
    </div>
    <label>Режим выполнения<select value={mode} onChange={e=>setMode(e.target.value as TaskAssignmentMode)}><option value="shared">Одна общая задача</option><option value="individual">Отдельное выполнение для каждого сотрудника</option></select></label>
    {error&&<div className="tasks-error">{error}</div>}<footer><button className="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={busy} onClick={()=>void submit()}>{busy?'Создаём…':'Создать задачу'}</button></footer>
  </section></div>;
}

function TaskDrawer({task,currentUserId,onClose,onStatus,onUpdated}:{task:WorkTask;currentUserId:string;onClose:()=>void;onStatus:(task:WorkTask,status:TaskStatus)=>Promise<void>;onUpdated:(task:WorkTask)=>void}){
  const [comment,setComment]=useState(''); const [busy,setBusy]=useState(false); const mine=task.executions.find(e=>e.userId===currentUserId); const currentStatus=mine?.status||task.status;
  const post=async()=>{if(!comment.trim())return;setBusy(true);try{const response=await tasksApi.comment(task.id,comment.trim());setComment('');onUpdated(response.task);}finally{setBusy(false);}};
  return <div className="task-drawer-backdrop" onClick={onClose}><aside className="task-drawer" onClick={e=>e.stopPropagation()}><header><div><span className={`task-priority task-priority--${task.priority}`}>{priorityLabels[task.priority]}</span><h2>{task.title}</h2></div><button onClick={onClose}><X/></button></header><p className="task-description">{task.description||'Без описания'}</p>
    <div className="task-drawer-grid"><article><small>Статус</small><strong>{statusLabels[currentStatus]}</strong></article><article><small>Срок</small><strong>{task.dueAt?new Date(task.dueAt).toLocaleString('ru-RU'):'Без срока'}</strong></article><article><small>Постановщик</small><strong>{task.createdByName||'Система'}</strong></article><article><small>Режим</small><strong>{task.assignmentMode==='individual'?'Каждому отдельно':'Общий'}</strong></article></div>
    <section><h3>Изменить статус</h3><div className="task-status-actions">{(['todo','in_progress','review','done'] as TaskStatus[]).map(status=><button key={status} className={currentStatus===status?'active':''} onClick={()=>void onStatus(task,status)}>{status==='done'?<CheckCircle2 size={15}/>:<CircleDot size={15}/>} {statusLabels[status]}</button>)}</div></section>
    <section><h3>Адресаты</h3><div className="tasks-selected-targets">{task.targets.map(t=><span key={t.id}>{t.targetLabel}</span>)}</div></section>
    {task.assignmentMode==='individual'&&<section><h3>Выполнение сотрудников</h3><div className="task-executions">{task.executions.map(ex=><div key={ex.id}><span>{ex.userName}</span><b>{statusLabels[ex.status]}</b></div>)}</div></section>}
    <section><h3><MessageSquare size={16}/> Комментарии</h3><div className="task-comments">{(task.comments||[]).map(c=><article key={c.id}><strong>{c.userName}</strong><p>{c.body}</p><small>{new Date(c.createdAt).toLocaleString('ru-RU')}</small></article>)}</div><div className="task-comment-form"><textarea rows={3} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Добавить комментарий"/><button className="button button--primary" disabled={busy} onClick={()=>void post()}>Отправить</button></div></section>
  </aside></div>;
}
