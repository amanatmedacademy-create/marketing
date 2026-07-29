import { useMemo, useState } from 'react';
import { Bot, CalendarDays, CheckCircle2, Circle, ListTodo, Megaphone, Play, Plus, RefreshCw, ShieldCheck, Target } from 'lucide-react';

type Campaign = {
  id: string;
  name: string;
  channel: string;
  objective: string;
  owner: string;
  budget: number;
  status: 'Активна' | 'План' | 'Пауза';
  start: string;
  end: string;
};

type Task = {
  id: string;
  title: string;
  owner: string;
  due: string;
  priority: 'Высокий' | 'Средний' | 'Низкий';
  done: boolean;
};

type Automation = {
  id: string;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
  lastRun: string;
};

const campaigns: Campaign[] = [
  { id: 'cmp-1', name: 'Грыжа — запись на диагностику', channel: 'Meta', objective: 'Лиды', owner: 'Performance', budget: 900000, status: 'Активна', start: '2026-07-01', end: '2026-08-31' },
  { id: 'cmp-2', name: 'Суставы — экспертные Reels', channel: 'Instagram', objective: 'Охват', owner: 'Content', budget: 280000, status: 'Активна', start: '2026-07-15', end: '2026-08-15' },
  { id: 'cmp-3', name: 'Ретаргетинг посетителей сайта', channel: 'TikTok', objective: 'Конверсии', owner: 'Performance', budget: 420000, status: 'План', start: '2026-08-01', end: '2026-08-31' },
];

const initialTasks: Task[] = [
  { id: 'tsk-1', title: 'Проверить расхождение Meta и Bitrix по лидам', owner: 'Аналитик', due: '2026-07-29', priority: 'Высокий', done: false },
  { id: 'tsk-2', title: 'Подготовить 5 новых хуков по грыжам', owner: 'Контент', due: '2026-07-30', priority: 'Высокий', done: false },
  { id: 'tsk-3', title: 'Отключить объявления с CPL выше лимита', owner: 'Таргетолог', due: '2026-07-29', priority: 'Средний', done: true },
  { id: 'tsk-4', title: 'Обновить UTM-справочник кампаний', owner: 'Маркетолог', due: '2026-08-01', priority: 'Низкий', done: false },
];

const initialAutomations: Automation[] = [
  { id: 'aut-1', name: 'Контроль дорогих лидов', trigger: 'CPL > 12 000 ₸', action: 'Создать задачу и отправить уведомление', enabled: true, lastRun: 'Сегодня, 17:40' },
  { id: 'aut-2', name: 'Лид без ответа', trigger: 'Нет контакта 15 минут', action: 'Назначить повторный звонок оператору', enabled: true, lastRun: 'Сегодня, 18:05' },
  { id: 'aut-3', name: 'Провал UTM', trigger: 'utm_source отсутствует', action: 'Пометить аномалию в журнале', enabled: true, lastRun: 'Сегодня, 18:10' },
  { id: 'aut-4', name: 'Еженедельный отчёт', trigger: 'Понедельник, 09:00', action: 'Сформировать KPI-сводку', enabled: false, lastRun: 'Не запускалась' },
];

const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(value);

export default function MarketingOS() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [automations, setAutomations] = useState<Automation[]>(initialAutomations);
  const [taskTitle, setTaskTitle] = useState('');
  const [filter, setFilter] = useState('Все');

  const visibleTasks = useMemo(() => tasks.filter(task => filter === 'Все' || (filter === 'Открытые' ? !task.done : task.done)), [tasks, filter]);
  const totalBudget = campaigns.reduce((sum, item) => sum + item.budget, 0);
  const openTasks = tasks.filter(task => !task.done).length;
  const activeAutomations = automations.filter(item => item.enabled).length;

  const addTask = () => {
    const title = taskTitle.trim();
    if (!title) return;
    setTasks(current => [{ id: `tsk-${Date.now()}`, title, owner: 'Не назначен', due: new Date().toISOString().slice(0, 10), priority: 'Средний', done: false }, ...current]);
    setTaskTitle('');
  };

  return <div className="stack marketing-os">
    <div className="page-top">
      <div className="heading"><span>Marketing operating system</span><h1>Центр управления маркетингом</h1><p>Кампании, контент, задачи, автоматизации и контроль исполнения в одном рабочем пространстве.</p></div>
      <button className="button button--primary"><Play size={16}/> Запустить цикл</button>
    </div>

    <div className="metrics">
      <article className="metric"><span>Кампании</span><strong>{campaigns.length}</strong><small>2 активны</small></article>
      <article className="metric"><span>Плановый бюджет</span><strong>{money(totalBudget)}</strong><small>На текущий цикл</small></article>
      <article className="metric"><span>Открытые задачи</span><strong>{openTasks}</strong><small>{tasks.length - openTasks} завершено</small></article>
      <article className="metric"><span>Автоматизации</span><strong>{activeAutomations}</strong><small>Из {automations.length} включены</small></article>
      <article className="metric"><span>Контроль данных</span><strong>96%</strong><small>UTM и CRM заполненность</small></article>
      <article className="metric"><span>Скорость реакции</span><strong>8 мин</strong><small>Медиана первого контакта</small></article>
    </div>

    <section className="panel">
      <div className="panel-title-row"><div><h2>Кампании и инициативы</h2><p className="note">Единый реестр оплачиваемых и органических активностей.</p></div><button className="button"><Plus size={16}/> Кампания</button></div>
      <div className="table-wrap"><table><thead><tr><th>Кампания</th><th>Канал</th><th>Цель</th><th>Ответственный</th><th>Бюджет</th><th>Период</th><th>Статус</th></tr></thead><tbody>{campaigns.map(item => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.channel}</td><td>{item.objective}</td><td>{item.owner}</td><td>{money(item.budget)}</td><td>{item.start} — {item.end}</td><td><span className={`badge ${item.status === 'Активна' ? 'badge--green' : item.status === 'План' ? 'badge--amber' : ''}`}>{item.status}</span></td></tr>)}</tbody></table></div>
    </section>

    <div className="grid-2">
      <section className="panel">
        <div className="panel-title-row"><div><h2>Очередь задач</h2><p className="note">Исполнение маркетингового цикла.</p></div><select value={filter} onChange={event => setFilter(event.target.value)}><option>Все</option><option>Открытые</option><option>Готовые</option></select></div>
        <div className="task-create"><input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} onKeyDown={event => event.key === 'Enter' && addTask()} placeholder="Новая задача"/><button className="button button--primary" onClick={addTask}><Plus size={16}/></button></div>
        <div className="task-list">{visibleTasks.map(task => <button className={`task-row ${task.done ? 'is-done' : ''}`} key={task.id} onClick={() => setTasks(current => current.map(item => item.id === task.id ? { ...item, done: !item.done } : item))}>{task.done ? <CheckCircle2 size={19}/> : <Circle size={19}/>}<span><b>{task.title}</b><small>{task.owner} · до {task.due}</small></span><i className={`priority priority--${task.priority.toLowerCase()}`}>{task.priority}</i></button>)}</div>
      </section>

      <section className="panel">
        <div className="panel-title-row"><div><h2>Контент-план</h2><p className="note">Ближайшие материалы и контроль производства.</p></div><CalendarDays size={20}/></div>
        <div className="content-plan">
          <article><time>29 июл</time><div><b>Почему блокада не лечит грыжу</b><small>Reels · Врач Арман · Монтаж</small></div><span className="badge badge--amber">Сегодня</span></article>
          <article><time>30 июл</time><div><b>3 ошибки при боли в колене</b><small>TikTok · Доктор Микаил · Съёмка</small></div><span className="badge">В работе</span></article>
          <article><time>31 июл</time><div><b>Разбор МРТ: грыжа 5 мм</b><small>YouTube Shorts · Эксперт · Сценарий</small></div><span className="badge">План</span></article>
          <article><time>01 авг</time><div><b>История пациента после курса</b><small>Instagram · Кейс · Согласование</small></div><span className="badge badge--green">Готово</span></article>
        </div>
      </section>
    </div>

    <section className="panel">
      <div className="panel-title-row"><div><h2>Автоматизации</h2><p className="note">Правила контроля, уведомлений и реакции на события.</p></div><button className="button"><RefreshCw size={16}/> Проверить правила</button></div>
      <div className="automation-grid">{automations.map(item => <article className="automation-card" key={item.id}><header><div className="automation-icon"><Bot size={19}/></div><button className={`switch ${item.enabled ? 'is-on' : ''}`} onClick={() => setAutomations(current => current.map(row => row.id === item.id ? { ...row, enabled: !row.enabled } : row))}><span/></button></header><h3>{item.name}</h3><p><Target size={14}/><span><b>Условие:</b> {item.trigger}</span></p><p><Megaphone size={14}/><span><b>Действие:</b> {item.action}</span></p><footer><ShieldCheck size={14}/> {item.lastRun}</footer></article>)}</div>
    </section>

    <div className="grid-2">
      <section className="panel"><div className="panel-title-row"><h2>Контрольные сигналы</h2><ShieldCheck size={20}/></div><div className="signal-list"><p><span className="signal signal--red"/>Meta: расхождение 14 лидов с CRM</p><p><span className="signal signal--amber"/>7 объявлений превышают CPL-лимит</p><p><span className="signal signal--green"/>Webhook Bitrix работает штатно</p><p><span className="signal signal--green"/>Данные TikTok обновлены 12 минут назад</p></div></section>
      <section className="panel"><div className="panel-title-row"><h2>Журнал активности</h2><ListTodo size={20}/></div><div className="activity-list"><p><b>18:10</b><span>Автоматизация отметила 3 лида без UTM</span></p><p><b>18:05</b><span>Созданы повторные звонки по 6 лидам</span></p><p><b>17:40</b><span>Обнаружено превышение CPL в кампании «Грыжа»</span></p><p><b>16:20</b><span>Контент «История пациента» переведён в статус «Готово»</span></p></div></section>
    </div>
  </div>;
}
