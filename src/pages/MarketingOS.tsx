import { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarDays, CheckCircle2, Circle, ListTodo, Megaphone, Play, Plus, RefreshCw, Search, ShieldCheck, Target, X } from 'lucide-react';
import { operationsApi, type ActivityFilters, type ActivityItem, type AutomationRule, type Campaign, type ContentItem, type MarketingTask } from '../services/operations';

const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(value);
const formatDate = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—';
const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year:'numeric', hour: '2-digit', minute: '2-digit', second:'2-digit' }) : 'Не запускалась';
const statusLabel = (value?: string | null) => value === 'error' ? 'Ошибка' : value === 'warning' ? 'Предупреждение' : 'Успешно';
const actionLabel = (value?: string | null) => value === 'create' ? 'Создание' : value === 'update' ? 'Изменение' : value === 'delete' ? 'Удаление' : value || '—';
const jsonText = (value?: Record<string, unknown> | null) => value ? JSON.stringify(value, null, 2) : 'Нет данных';

export default function MarketingOS() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tasks, setTasks] = useState<MarketingTask[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [filter, setFilter] = useState('Все');
  const [auditFilters,setAuditFilters] = useState<ActivityFilters>({limit:200});
  const [auditLoading,setAuditLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = async (filters = auditFilters) => {
    setAuditLoading(true);
    try { setActivity(await operationsApi.activity.list(filters)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить журнал'); }
    finally { setAuditLoading(false); }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [campaignRows, taskRows, contentRows, automationRows, activityRows] = await Promise.all([
        operationsApi.campaigns.list(), operationsApi.tasks.list(), operationsApi.content.list(),
        operationsApi.automations.list(), operationsApi.activity.list(auditFilters),
      ]);
      setCampaigns(campaignRows); setTasks(taskRows); setContent(contentRows); setAutomations(automationRows); setActivity(activityRows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить данные'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const visibleTasks = useMemo(() => tasks.filter(task => filter === 'Все' || (filter === 'Открытые' ? !task.done : task.done)), [tasks, filter]);
  const totalBudget = campaigns.reduce((sum, item) => sum + Number(item.budget || 0), 0);
  const openTasks = tasks.filter(task => !task.done).length;
  const activeAutomations = automations.filter(item => item.enabled).length;
  const auditModules = useMemo(() => Array.from(new Set(activity.map(item=>item.module).filter(Boolean) as string[])).sort(),[activity]);
  const auditActors = useMemo(() => Array.from(new Set(activity.map(item=>item.actor_email).filter(Boolean) as string[])).sort(),[activity]);

  const addTask = async () => {
    const title = taskTitle.trim(); if (!title) return;
    try {
      const rows = await operationsApi.tasks.create({ title, owner: 'Не назначен', due_on: new Date().toISOString().slice(0, 10), priority: 'Средний', done: false });
      setTasks(current => [...rows, ...current]); setTaskTitle(''); await loadActivity();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать задачу'); }
  };

  const toggleTask = async (task: MarketingTask) => {
    try {
      const rows = await operationsApi.tasks.update(task.id, { done: !task.done });
      setTasks(current => current.map(item => item.id === task.id ? rows[0] || { ...item, done: !item.done } : item));
      await loadActivity();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось обновить задачу'); }
  };

  const toggleAutomation = async (rule: AutomationRule) => {
    try {
      const rows = await operationsApi.automations.update(rule.id, { enabled: !rule.enabled });
      setAutomations(current => current.map(item => item.id === rule.id ? rows[0] || { ...item, enabled: !item.enabled } : item));
      await loadActivity();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось обновить автоматизацию'); }
  };

  const applyAuditFilters = () => void loadActivity(auditFilters);
  const resetAuditFilters = () => { const next:ActivityFilters={limit:200}; setAuditFilters(next); void loadActivity(next); };

  return <div className="stack marketing-os">
    <div className="page-top"><div className="heading"><span>Marketing operating system</span><h1>Центр управления маркетингом</h1><p>Кампании, контент, задачи, автоматизации и контроль исполнения в одном рабочем пространстве.</p></div><button className="button button--primary" onClick={load} disabled={loading}>{loading ? <RefreshCw className="spin" size={16}/> : <Play size={16}/>} Обновить данные</button></div>
    {error && <div className="alert alert--error">{error}</div>}

    <div className="metrics"><article className="metric"><span>Кампании</span><strong>{campaigns.length}</strong><small>{campaigns.filter(item => item.status === 'Активна').length} активны</small></article><article className="metric"><span>Плановый бюджет</span><strong>{money(totalBudget)}</strong><small>По реестру кампаний</small></article><article className="metric"><span>Открытые задачи</span><strong>{openTasks}</strong><small>{tasks.length - openTasks} завершено</small></article><article className="metric"><span>Автоматизации</span><strong>{activeAutomations}</strong><small>Из {automations.length} включены</small></article><article className="metric"><span>Контент</span><strong>{content.length}</strong><small>Материалов в плане</small></article><article className="metric"><span>Журнал</span><strong>{activity.length}</strong><small>Событий по текущему фильтру</small></article></div>

    <section className="panel"><div className="panel-title-row"><div><h2>Кампании и инициативы</h2><p className="note">Данные из marketing_campaigns.</p></div><button className="button" onClick={load}><RefreshCw size={16}/> Обновить</button></div>{campaigns.length === 0 ? <p className="note">Кампаний пока нет.</p> : <div className="table-wrap"><table><thead><tr><th>Кампания</th><th>Канал</th><th>Цель</th><th>Ответственный</th><th>Бюджет</th><th>Период</th><th>Статус</th></tr></thead><tbody>{campaigns.map(item => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.channel}</td><td>{item.objective}</td><td>{item.owner}</td><td>{money(Number(item.budget || 0))}</td><td>{formatDate(item.starts_on)} — {formatDate(item.ends_on)}</td><td><span className={`badge ${item.status === 'Активна' ? 'badge--green' : item.status === 'План' ? 'badge--amber' : ''}`}>{item.status}</span></td></tr>)}</tbody></table></div>}</section>

    <div className="grid-2"><section className="panel"><div className="panel-title-row"><div><h2>Очередь задач</h2><p className="note">Создание и изменение сохраняются в Supabase и журнале аудита.</p></div><select value={filter} onChange={event => setFilter(event.target.value)}><option>Все</option><option>Открытые</option><option>Готовые</option></select></div><div className="task-create"><input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} onKeyDown={event => event.key === 'Enter' && void addTask()} placeholder="Новая задача"/><button className="button button--primary" onClick={() => void addTask()}><Plus size={16}/></button></div><div className="task-list">{visibleTasks.map(task => <button className={`task-row ${task.done ? 'is-done' : ''}`} key={task.id} onClick={() => void toggleTask(task)}>{task.done ? <CheckCircle2 size={19}/> : <Circle size={19}/>}<span><b>{task.title}</b><small>{task.owner} · до {formatDate(task.due_on)}</small></span><i className={`priority priority--${task.priority.toLowerCase()}`}>{task.priority}</i></button>)}</div></section><section className="panel"><div className="panel-title-row"><div><h2>Контент-план</h2><p className="note">Публикации из marketing_content_plan.</p></div><CalendarDays size={20}/></div><div className="content-plan">{content.map(item => <article key={item.id}><time>{formatDate(item.publish_on)}</time><div><b>{item.title}</b><small>{item.platform || 'Площадка не указана'} · {item.owner || 'Не назначен'} · {item.production_stage}</small></div><span className={`badge ${item.status === 'Готово' ? 'badge--green' : item.status === 'Сегодня' ? 'badge--amber' : ''}`}>{item.status}</span></article>)}</div></section></div>

    <section className="panel"><div className="panel-title-row"><div><h2>Автоматизации</h2><p className="note">Каждое изменение состояния записывается в аудит.</p></div><button className="button" onClick={load}><RefreshCw size={16}/> Проверить правила</button></div><div className="automation-grid">{automations.map(item => <article className="automation-card" key={item.id}><header><div className="automation-icon"><Bot size={19}/></div><button className={`switch ${item.enabled ? 'is-on' : ''}`} onClick={() => void toggleAutomation(item)}><span/></button></header><h3>{item.name}</h3><p><Target size={14}/><span><b>Условие:</b> {item.trigger_text}</span></p><p><Megaphone size={14}/><span><b>Действие:</b> {item.action_text}</span></p><footer><ShieldCheck size={14}/> {formatDateTime(item.last_run_at)}</footer></article>)}</div></section>

    <section className="panel"><div className="panel-title-row"><div><h2>Журнал аудита</h2><p className="note">Пользователь, модуль, действие, статус, объект и изменения до/после.</p></div><button className="button" onClick={applyAuditFilters} disabled={auditLoading}><RefreshCw className={auditLoading?'spin':''} size={16}/> Обновить</button></div>
      <div className="ads-filter-panel">
        <label><span>Поиск</span><div className="ads-search"><Search size={15}/><input value={auditFilters.search||''} onChange={e=>setAuditFilters(v=>({...v,search:e.target.value}))} placeholder="Сообщение, событие, пользователь"/></div></label>
        <label><span>Модуль</span><select value={auditFilters.module||''} onChange={e=>setAuditFilters(v=>({...v,module:e.target.value}))}><option value="">Все модули</option>{auditModules.map(item=><option key={item}>{item}</option>)}</select></label>
        <label><span>Действие</span><select value={auditFilters.action||''} onChange={e=>setAuditFilters(v=>({...v,action:e.target.value}))}><option value="">Все действия</option><option value="create">Создание</option><option value="update">Изменение</option><option value="delete">Удаление</option></select></label>
        <label><span>Статус</span><select value={auditFilters.status||''} onChange={e=>setAuditFilters(v=>({...v,status:e.target.value as ActivityFilters['status']}))}><option value="">Все статусы</option><option value="success">Успешно</option><option value="warning">Предупреждение</option><option value="error">Ошибка</option></select></label>
        <label><span>Пользователь</span><select value={auditFilters.actor||''} onChange={e=>setAuditFilters(v=>({...v,actor:e.target.value}))}><option value="">Все пользователи</option>{auditActors.map(item=><option key={item}>{item}</option>)}</select></label>
        <label><span>Дата от</span><input type="date" value={auditFilters.from||''} onChange={e=>setAuditFilters(v=>({...v,from:e.target.value}))}/></label>
        <label><span>Дата до</span><input type="date" value={auditFilters.to||''} onChange={e=>setAuditFilters(v=>({...v,to:e.target.value}))}/></label>
        <button className="button button--primary" onClick={applyAuditFilters}><Search size={14}/>Применить</button><button className="button" onClick={resetAuditFilters}><X size={14}/>Сбросить</button>
      </div>
      {activity.length===0 ? <p className="note">События по выбранным условиям не найдены.</p> : <div className="table-wrap"><table><thead><tr><th>Время</th><th>Пользователь</th><th>Модуль</th><th>Действие</th><th>Статус</th><th>Событие</th><th>Объект</th><th>Изменения</th></tr></thead><tbody>{activity.map(item=><tr key={item.id}><td>{formatDateTime(item.created_at)}</td><td><b>{item.actor_name||item.actor_email||'Система'}</b><small>{item.ip_address||'IP не передан'}</small></td><td>{item.module||item.entity_type||'—'}</td><td>{actionLabel(item.action)}</td><td><span className={`badge ${item.status==='success'?'badge--green':item.status==='warning'?'badge--amber':''}`}>{statusLabel(item.status)}</span></td><td><b>{item.event_type}</b><small>{item.message}</small></td><td><small>{item.entity_type||'—'}<br/>{item.entity_id||'—'}<br/>{item.request_id?`Request: ${item.request_id}`:''}</small></td><td><details><summary>Открыть</summary><div className="grid-2"><div><b>До</b><pre>{jsonText(item.old_values)}</pre></div><div><b>После</b><pre>{jsonText(item.new_values)}</pre></div></div></details></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel"><div className="panel-title-row"><h2>Состояние данных</h2><ShieldCheck size={20}/></div><div className="signal-list"><p><span className={`signal ${error ? 'signal--red' : 'signal--green'}`}/>{error ? 'Operations API требует проверки' : 'Operations API отвечает штатно'}</p><p><span className="signal signal--green"/>CRUD-операции подключены к структурированному аудиту</p><p><span className="signal signal--amber"/>Миграция audit_log_v2 должна быть применена в рабочем Supabase</p></div></section>
  </div>;
}
