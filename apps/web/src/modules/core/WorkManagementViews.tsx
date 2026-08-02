import { useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, FolderKanban, Plus, X } from 'lucide-react';
import {
  useCreateProjectMutation,
  useCreateTaskMutation,
  useProjectsQuery,
  useTasksQuery,
  useToggleTaskMutation,
  type TaskItem,
  type TaskPriority,
} from './useCrmModules';
import './work-management.css';

const priorityLabel: Record<TaskPriority, string> = {
  urgent: 'Срочно',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

function isoFromLocal(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

export function TasksWorkspace() {
  const tasks = useTasksQuery();
  const projects = useProjectsQuery();
  const createTask = useCreateTaskMutation();
  const toggleTask = useToggleTaskMutation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueAt, setDueAt] = useState('');
  const [projectId, setProjectId] = useState('');

  const items = tasks.data ?? [];
  const activeCount = items.filter(item => item.status !== 'done' && item.status !== 'cancelled').length;
  const groups = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const result = { overdue: [] as TaskItem[], today: [] as TaskItem[], upcoming: [] as TaskItem[], done: [] as TaskItem[] };
    items.forEach(task => {
      if (task.status === 'done') return result.done.push(task);
      if (!task.due_at) return result.today.push(task);
      const due = new Date(task.due_at);
      if (due < today) return result.overdue.push(task);
      if (due < tomorrow) return result.today.push(task);
      result.upcoming.push(task);
    });
    return result;
  }, [items]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    await createTask.mutateAsync({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      dueAt: isoFromLocal(dueAt),
      projectId: projectId || undefined,
    });
    setTitle(''); setDescription(''); setPriority('medium'); setDueAt(''); setProjectId(''); setOpen(false);
  };

  const renderGroup = (label: string, group: TaskItem[]) => group.length ? <section className="wm-group">
    <h3>{label}<span>{group.length}</span></h3>
    <div className="wm-task-list">{group.map(task => <article className={`wm-task ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
      <label className="wm-check"><input type="checkbox" checked={task.status === 'done'} disabled={toggleTask.isPending} onChange={event => toggleTask.mutate({ id: task.id, done: event.target.checked })} /><span /></label>
      <div className="wm-task-copy"><strong>{task.title}</strong>{task.description && <p>{task.description}</p>}<small>{task.due_at ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(task.due_at)) : 'Без срока'}</small></div>
      <b className={`priority ${task.priority}`}>{priorityLabel[task.priority]}</b>
    </article>)}</div>
  </section> : null;

  return <div className="view-page wm-page">
    <div className="wm-heading"><div><h1>Задачи</h1><p>{activeCount} активных · {items.length} всего</p></div><button className="wm-primary" onClick={() => setOpen(true)}><Plus size={17} />Создать задачу</button></div>
    {tasks.isError && <div className="wm-error">Не удалось загрузить задачи. <button onClick={() => void tasks.refetch()}>Повторить</button></div>}
    {tasks.isLoading ? <div className="empty-state">Загрузка задач…</div> : !items.length ? <div className="wm-empty"><CalendarDays size={34} /><h2>Задач пока нет</h2><p>Создайте первую задачу, назначьте срок и приоритет.</p><button className="wm-primary" onClick={() => setOpen(true)}><Plus size={17} />Создать задачу</button></div> : <div className="wm-content">{renderGroup('Просрочено', groups.overdue)}{renderGroup('Сегодня и без срока', groups.today)}{renderGroup('Предстоящие', groups.upcoming)}{renderGroup('Выполнено', groups.done)}</div>}
    {open && <div className="wm-modal-backdrop" onMouseDown={() => setOpen(false)}><form className="wm-modal" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><div className="wm-modal-head"><div><h2>Новая задача</h2><p>Добавьте задачу в рабочий план.</p></div><button type="button" className="wm-close" onClick={() => setOpen(false)}><X size={18} /></button></div><label>Название<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="Например: Подготовить отчёт" required /></label><label>Описание<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Детали задачи" rows={3} /></label><div className="wm-form-grid"><label>Приоритет<select value={priority} onChange={event => setPriority(event.target.value as TaskPriority)}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option><option value="urgent">Срочно</option></select></label><label>Срок<input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label></div><label>Проект<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Без проекта</option>{(projects.data ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="wm-actions"><button type="button" className="wm-secondary" onClick={() => setOpen(false)}>Отмена</button><button className="wm-primary" disabled={createTask.isPending}>{createTask.isPending ? 'Создание…' : 'Создать задачу'}</button></div></form></div>}
  </div>;
}

export function ProjectsWorkspace() {
  const projects = useProjectsQuery();
  const createProject = useCreateProjectMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueAt, setDueAt] = useState('');
  const items = projects.data ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await createProject.mutateAsync({ name: name.trim(), description: description.trim() || undefined, priority, dueAt: isoFromLocal(dueAt) });
    setName(''); setDescription(''); setPriority('medium'); setDueAt(''); setOpen(false);
  };

  return <div className="view-page wm-page">
    <div className="wm-heading"><div><h1>Проекты</h1><p>{items.length} проектов</p></div><button className="wm-primary" onClick={() => setOpen(true)}><Plus size={17} />Создать проект</button></div>
    {projects.isError && <div className="wm-error">Не удалось загрузить проекты. <button onClick={() => void projects.refetch()}>Повторить</button></div>}
    {projects.isLoading ? <div className="empty-state">Загрузка проектов…</div> : !items.length ? <div className="wm-empty"><FolderKanban size={34} /><h2>Проектов пока нет</h2><p>Создайте проект и затем связывайте с ним задачи.</p><button className="wm-primary" onClick={() => setOpen(true)}><Plus size={17} />Создать проект</button></div> : <div className="wm-project-grid">{items.map(project => {
      const done = project.items.filter(item => item.status === 'done').length;
      const progress = project.items.length ? Math.round(done / project.items.length * 100) : 0;
      return <article className="wm-project-card" key={project.id}><div className="wm-project-top"><span className="module-icon"><FolderKanban size={17} /></span><b className={`priority ${project.priority ?? 'medium'}`}>{priorityLabel[project.priority ?? 'medium']}</b></div><h2>{project.name}</h2><p>{project.description || 'Описание не добавлено'}</p><div className="wm-progress"><span><b style={{ width: `${progress}%` }} /></span><small>{done} из {project.items.length} задач · {progress}%</small></div>{project.due_at && <footer>Срок: {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(project.due_at))}</footer>}</article>;
    })}</div>}
    {open && <div className="wm-modal-backdrop" onMouseDown={() => setOpen(false)}><form className="wm-modal" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><div className="wm-modal-head"><div><h2>Новый проект</h2><p>Создайте рабочее пространство проекта.</p></div><button type="button" className="wm-close" onClick={() => setOpen(false)}><X size={18} /></button></div><label>Название<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Название проекта" required /></label><label>Описание<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Цель и детали проекта" rows={4} /></label><div className="wm-form-grid"><label>Приоритет<select value={priority} onChange={event => setPriority(event.target.value as TaskPriority)}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option><option value="urgent">Срочно</option></select></label><label>Срок<input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label></div><div className="wm-actions"><button type="button" className="wm-secondary" onClick={() => setOpen(false)}>Отмена</button><button className="wm-primary" disabled={createProject.isPending}>{createProject.isPending ? 'Создание…' : 'Создать проект'}</button></div></form></div>}
  </div>;
}
