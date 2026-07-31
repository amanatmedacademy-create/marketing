import { useEffect, useMemo, useState } from 'react';
import {
  Bell, Cable, CalendarDays, Cloud, FolderKanban, Headphones, Instagram,
  LayoutDashboard, Mail, Megaphone, MessageCircle, Moon, Search, Settings,
  Sun, Trophy, UsersRound, Video, WalletCards, Workflow,
} from 'lucide-react';
import { KanbanBoard } from './modules/deals/components/KanbanBoard';
import {
  useAccountingQuery,
  useProjectsQuery,
  useTasksQuery,
  useTeamQuery,
  useToggleTaskMutation,
  type TaskItem,
} from './modules/core/useCrmModules';

type View = 'dashboard' | 'deals' | 'tasks' | 'projects' | 'team' | 'accounting';
type OpenMenu = 'notifications' | 'profile' | null;
type DashboardResponse = {
  metrics: { amountInWork: number; newDeals: number; openTasks: number; unansweredConversations: number };
  stages: Array<{ id: string; name: string; position: number }>;
};

const primaryNavigation = [
  { id: 'dashboard' as View, label: 'Дашборд', icon: LayoutDashboard },
  { id: 'deals' as View, label: 'Сделки', icon: Workflow },
  { id: 'tasks' as View, label: 'Задачи', icon: CalendarDays },
  { id: 'projects' as View, label: 'Проекты', icon: FolderKanban },
  { id: 'team' as View, label: 'Команда', icon: UsersRound },
  { id: 'accounting' as View, label: 'Бухгалтерия', icon: WalletCards },
];
const secondaryNavigation = [
  ['WhatsApp', MessageCircle], ['Instagram', Instagram], ['Email', Mail],
  ['Реклама', Megaphone], ['Облако', Cloud], ['Видеовстречи', Video], ['Интеграции', Cable],
] as const;
const modules = [
  ['Мессенджеры', 'Нужен WhatsApp Business API токен.', MessageCircle, 'Блокировано'],
  ['Реклама', 'Нужны App ID и Secret рекламных площадок.', Megaphone, 'Блокировано'],
  ['Облако', 'Нужно решение: R2, S3 или локальный диск.', Cloud, 'Блокировано'],
  ['Видеовстречи', 'Нужен провайдер: LiveKit, Daily или Jitsi.', Video, 'Блокировано'],
  ['Настройки', 'Большинство подразделов ещё не реализовано.', Settings, 'Не блокировано'],
  ['Геймификация', 'Лидерборд, баллы и бонусные цели.', Trophy, 'Не блокировано'],
] as const;
const taskFallback: TaskItem[] = [
  { id: 'fallback-1', title: 'Перезвонить Марату С. — уточнить дату МРТ', priority: 'urgent', status: 'todo', due_at: '2026-07-31T09:00:00+05:00' },
  { id: 'fallback-2', title: 'Отправить смету Бекзату Н.', priority: 'high', status: 'todo', due_at: '2026-07-31T12:00:00+05:00' },
  { id: 'fallback-3', title: 'Консультация — Ольга В., 15:00', priority: 'medium', status: 'todo', due_at: '2026-08-01T15:00:00+05:00' },
];

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Almaty' });

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(new Date());
  const [bannerVisible, setBannerVisible] = useState(true);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { const close = () => setOpenMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dashboard', { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(`Ошибка API: ${response.status}`); return response.json() as Promise<DashboardResponse>; })
      .then(setDashboard)
      .catch((reason) => { if (reason instanceof DOMException && reason.name === 'AbortError') return; setError(reason instanceof Error ? reason.message : 'Нет соединения'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const metrics = useMemo(() => [
    ['Сумма в работе', money.format(dashboard?.metrics.amountInWork ?? 4_280_000), '▲ 12% за неделю', 'up'],
    ['Открытых задач', String(dashboard?.metrics.openTasks ?? 11), '4 просрочено', 'down'],
    ['Сделок в работе', String(dashboard?.metrics.newDeals ?? 9), '▲ 2 за сегодня', 'up'],
    ['Конверсия в оплату', '34%', '▲ 5% за месяц', 'up'],
  ], [dashboard]);

  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Almaty' }).format(now);
  const date = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' }).format(now);
  const toggleMenu = (menu: Exclude<OpenMenu, null>) => (event: React.MouseEvent) => { event.stopPropagation(); setOpenMenu((current) => current === menu ? null : menu); };

  return <div className="satu-shell">
    <aside className="sidebar">
      <div className="brand-dot"><span /></div>
      <nav className="nav-primary">{primaryNavigation.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} title={label} onClick={() => setView(id)}><Icon size={18} /></button>)}</nav>
      <nav className="nav-secondary">{secondaryNavigation.map(([label, Icon]) => <button key={label} title={`${label} — скоро`}><Icon size={18} /></button>)}</nav>
      <button className="settings-button" title="Настройки"><Settings size={18} /></button>
    </aside>
    <main className="main-column">
      {bannerVisible && <section className="subscription-banner"><span>⚠️ <strong>Тариф скоро истекает</strong> — осталось 2 дня</span><div><button>Обновить тариф</button><button className="close-banner" onClick={() => setBannerVisible(false)}>×</button></div></section>}
      <header className="topbar">
        <div className="clock-block"><strong>{time}</strong><span>{date}</span></div>
        <label className="search-box"><Search size={16} /><input placeholder="Поиск или вопрос .J.A.R.V.I.S..." /><span className="ai-badge">AI</span></label>
        <div className="top-actions">
          <span className="score-pill">₸ <strong>1 280</strong></span><span className="phone-pill">☎ <strong>42 мин</strong></span>
          <button className="icon-button" onClick={() => setDark(v => !v)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button"><Headphones size={17} /></button>
          <div className="dropdown-wrap"><button className="icon-button notification-button" onClick={toggleMenu('notifications')}><Bell size={17} /><i /></button>{openMenu === 'notifications' && <div className="dropdown-menu" onClick={(event) => event.stopPropagation()}><div className="dropdown-head">Уведомления</div><button>⏰ 3 просроченные задачи</button><button>💬 Новое сообщение в WhatsApp</button><button>💰 Сделка перешла в «Оплата»</button></div>}</div>
          <div className="dropdown-wrap"><button className="avatar-button" onClick={toggleMenu('profile')}>АО</button>{openMenu === 'profile' && <div className="dropdown-menu" onClick={(event) => event.stopPropagation()}><div className="dropdown-head"><strong>Айдос Оунер</strong><span>OWNER</span></div><button>Профиль</button><button>Настройки</button><button>Выйти</button></div>}</div>
        </div>
      </header>
      <section className="content">
        {view === 'dashboard' && <Dashboard metrics={metrics} dashboard={dashboard} loading={loading} error={error} />}
        {view === 'deals' && <KanbanBoard />}
        {view === 'tasks' && <TasksView />}
        {view === 'projects' && <ProjectsView />}
        {view === 'team' && <TeamView />}
        {view === 'accounting' && <AccountingView />}
      </section>
    </main>
  </div>;
}

function Dashboard({ metrics, dashboard, loading, error }: { metrics: string[][]; dashboard: DashboardResponse | null; loading: boolean; error: string }) {
  const stages = dashboard?.stages.length ? dashboard.stages : [{ id: '1', name: 'Новый лид', position: 0 }, { id: '2', name: 'В работе', position: 1 }, { id: '3', name: 'Консультация назначена', position: 2 }, { id: '4', name: 'Оплата', position: 3 }, { id: '5', name: 'Отказ', position: 4 }];
  return <div className="view-page"><div className="welcome-row"><div><h1>Добро пожаловать, Айдос!</h1></div><span className={`connection-status ${error ? 'error' : ''}`}>{loading ? 'Подключение…' : error ? 'Демо-режим' : 'Supabase подключён'}</span></div><div className="kpi-grid">{metrics.map(([label, value, delta, tone]) => <article key={label} className="kpi-card"><span>{label}</span><strong>{loading ? '—' : value}</strong><small className={tone}>{delta}</small></article>)}</div><p className="dashboard-caption">Воронка продаж</p><section className="panel funnel-panel"><div className="funnel-list">{stages.map((stage, index) => <div key={stage.id}><span>{stage.name}</span><i><b style={{ width: `${Math.max(18, 100-index*18)}%` }} /></i><strong>{[9,6,3,2,1][index] ?? 0}</strong></div>)}</div></section><p className="dashboard-caption modules-caption">Модули без backend в этом превью:</p><div className="modules-grid">{modules.map(([title, description, Icon, status]) => <article className="module-card" key={title}><span className="module-icon"><Icon size={16} /></span><h3>{title}</h3><p>{description}</p><b>{status}</b></article>)}</div></div>;
}

function TasksView() {
  const query = useTasksQuery();
  const toggleTask = useToggleTaskMutation();
  const items = query.data?.length ? query.data : taskFallback;
  const now = new Date();
  const groups = ['Просрочено', 'Сегодня', 'Завтра'] as const;
  const groupFor = (task: TaskItem) => {
    if (!task.due_at) return 'Сегодня';
    const due = new Date(task.due_at);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    if (due < today && task.status !== 'done') return 'Просрочено';
    if (due >= tomorrow) return 'Завтра';
    return 'Сегодня';
  };
  const priorityLabel = { urgent: 'Срочно', high: 'Высокий', medium: 'Средний', low: 'Низкий' } as const;
  return <div className="view-page"><div className="view-title"><h1>Задачи</h1><span>{query.isLoading ? 'Загрузка…' : `${items.length} задач`}</span></div>{groups.map(group => <section className="task-group" key={group}><h3 className="section-label">{group}</h3>{items.filter(task => groupFor(task) === group).map(task => <label className="task-row" key={task.id}><input type="checkbox" checked={task.status === 'done'} disabled={task.id.startsWith('fallback-') || toggleTask.isPending} onChange={(event) => toggleTask.mutate({ id: task.id, done: event.target.checked })} /><span>{task.title}</span><b className={`priority ${task.priority}`}>{priorityLabel[task.priority]}</b></label>)}</section>)}</div>;
}

function ProjectsView() {
  const query = useProjectsQuery();
  const project = query.data?.[0];
  const fallback = [['To do','Согласовать прайс на курс реабилитации','Снять видео-отзывы пациентов'],['In progress','Настроить лендинг под направление','Обучить менеджеров скрипту'],['Done','Утвердить бюджет на запуск']];
  const columns = project ? [
    ['To do', ...project.items.filter(item => item.status === 'todo').map(item => item.title)],
    ['In progress', ...project.items.filter(item => item.status === 'in_progress').map(item => item.title)],
    ['Done', ...project.items.filter(item => item.status === 'done').map(item => item.title)],
  ] : fallback;
  return <div className="view-page"><div className="view-title"><h1>Проекты</h1><span>{project?.name ?? 'Пример: «Запуск нового направления»'}</span></div><div className="project-board">{columns.map(([title,...cards]) => <section key={title}><h3>{title}</h3>{cards.map(card => <article key={card}>{card}</article>)}</section>)}</div></div>;
}

function TeamView() {
  const query = useTeamQuery();
  const fallback = [
    { userId: '1', firstName: 'Айдос', lastName: 'Оунер', role: 'OWNER', department: 'Руководство', isOnline: true, lastSeenAt: new Date().toISOString(), avatarColor: '#4F6EF7' },
    { userId: '2', firstName: 'Гульнара', lastName: 'Админова', role: 'ADMIN', department: 'Продажи', isOnline: true, lastSeenAt: new Date(Date.now()-120000).toISOString(), avatarColor: '#16A34A' },
  ];
  const members = query.data?.length ? query.data : fallback;
  const initials = (first: string, last: string) => `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
  const activity = (value: string | null, online: boolean) => online ? 'сейчас' : value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }).format(new Date(value)) : 'нет данных';
  return <div className="view-page"><div className="view-title"><h1>Команда</h1><span>{members.length} сотрудника</span></div><div className="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Роль</th><th>Отдел</th><th>Статус</th><th>Активность</th></tr></thead><tbody>{members.map(member => <tr key={member.userId}><td><span className="member-avatar" style={{ background: member.avatarColor }}>{initials(member.firstName, member.lastName)}</span>{member.firstName} {member.lastName}</td><td><b className="role-chip">{member.role.toUpperCase()}</b></td><td>{member.department ?? 'Без отдела'}</td><td><i className={member.isOnline ? 'online' : ''} />{member.isOnline ? 'Онлайн' : 'Офлайн'}</td><td>{activity(member.lastSeenAt, member.isOnline)}</td></tr>)}</tbody></table></div></div>;
}

function AccountingView() {
  const query = useAccountingQuery();
  const data = query.data;
  const summary = data?.summary ?? { income: 2_840_000, expense: 640_000, profit: 2_200_000, vat: 340_800 };
  const transactions = data?.transactions.length ? data.transactions : [
    { id: '1', type: 'income' as const, amount: 420000, description: 'Оплата — курс лечения, Бекзат Н.', occurred_at: '2026-08-01T09:00:00+05:00', accountName: 'Касса' },
    { id: '2', type: 'expense' as const, amount: 150000, description: 'Аренда кабинета вертебролога', occurred_at: '2026-07-31T09:00:00+05:00', accountName: 'Расч. счёт' },
  ];
  return <div className="view-page"><div className="view-title"><h1>Бухгалтерия</h1></div><div className="kpi-grid"><article className="kpi-card"><span>Доход</span><strong className="income">{money.format(summary.income)}</strong></article><article className="kpi-card"><span>Расход</span><strong className="expense">{money.format(summary.expense)}</strong></article><article className="kpi-card"><span>Прибыль</span><strong>{money.format(summary.profit)}</strong></article><article className="kpi-card"><span>НДС</span><strong>{money.format(summary.vat)}</strong></article></div><div className="table-wrap"><table><thead><tr><th>Дата</th><th>Описание</th><th>Счёт</th><th>Сумма</th></tr></thead><tbody>{transactions.map(item => <tr key={item.id}><td>{dateFormatter.format(new Date(item.occurred_at))}</td><td>{item.description}</td><td>{item.accountName}</td><td className={item.type === 'income' ? 'income' : item.type === 'expense' ? 'expense' : ''}>{item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}{money.format(item.amount)}</td></tr>)}</tbody></table></div></div>;
}
