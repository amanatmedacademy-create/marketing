import { useEffect, useMemo, useState } from 'react';
import {
  Bell, Cable, CalendarDays, Cloud, FolderKanban, Headphones, Instagram,
  LayoutDashboard, Mail, Megaphone, MessageCircle, Moon, Search, Settings,
  Sun, UsersRound, Video, WalletCards, Workflow,
} from 'lucide-react';
import { KanbanBoard } from './modules/deals/components/KanbanBoard';

type View = 'dashboard' | 'deals' | 'tasks' | 'projects' | 'team' | 'accounting';
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

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
const tasks = [
  ['Перезвонить Марату С. — уточнить дату МРТ', 'Срочно', 'urgent'],
  ['Отправить смету Бекзату Н.', 'Высокий', 'high'],
  ['Консультация — Ольга В., 15:00', 'Средний', 'medium'],
  ['Согласовать абонемент с Гульмирой А.', 'Средний', 'medium'],
];
const team = [
  ['АО', 'Айдос Оунер', 'OWNER', 'Руководство', 'Онлайн', '#4F6EF7'],
  ['ГА', 'Гульнара Админова', 'ADMIN', 'Продажи', 'Онлайн', '#16A34A'],
  ['ЕМ', 'Ерлан Менеджеров', 'MANAGER', 'Продажи', 'Офлайн', '#F0A63B'],
];

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(new Date());
  const [bannerVisible, setBannerVisible] = useState(true);

  useEffect(() => document.documentElement.classList.toggle('dark', dark), [dark]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dashboard', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Ошибка API: ${response.status}`);
        return response.json() as Promise<DashboardResponse>;
      })
      .then(setDashboard)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Нет соединения');
      })
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

  return <div className="satu-shell">
    <aside className="sidebar">
      <div className="brand-dot"><span /></div>
      <nav className="nav-primary">
        {primaryNavigation.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} title={label} onClick={() => setView(id)}><Icon size={18} /></button>)}
      </nav>
      <nav className="nav-secondary">
        {secondaryNavigation.map(([label, Icon]) => <button key={label} title={`${label} — скоро`}><Icon size={18} /></button>)}
      </nav>
      <button className="settings-button" title="Настройки"><Settings size={18} /></button>
    </aside>

    <main className="main-column">
      {bannerVisible && <section className="subscription-banner"><span><strong>Тариф скоро истекает</strong> — осталось 2 дня</span><div><button>Обновить тариф</button><button className="close-banner" onClick={() => setBannerVisible(false)}>×</button></div></section>}
      <header className="topbar">
        <div className="clock-block"><strong>{time}</strong><span>{date}</span></div>
        <label className="search-box"><Search size={16} /><input placeholder="Поиск или вопрос J.A.R.V.I.S..." /><span className="ai-badge">AI</span></label>
        <div className="top-actions">
          <span className="score-pill">₸ <strong>1 280</strong></span><span className="phone-pill">☎ <strong>42 мин</strong></span>
          <button className="icon-button" onClick={() => setDark(v => !v)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-button"><Headphones size={17} /></button><button className="icon-button notification-button"><Bell size={17} /><i /></button><button className="avatar-button">АО</button>
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
  return <div className="view-page">
    <div className="welcome-row"><div><h1>Добро пожаловать, Айдос!</h1><p>Компания: <code>demo-company</code> · роль: <code>OWNER</code></p></div><span className={`connection-status ${error ? 'error' : ''}`}>{loading ? 'Подключение…' : error ? 'Демо-режим' : 'Supabase подключён'}</span></div>
    <div className="kpi-grid">{metrics.map(([label, value, delta, tone]) => <article key={label} className="kpi-card"><span>{label}</span><strong>{loading ? '—' : value}</strong><small className={tone}>{delta}</small></article>)}</div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><span>ВОРОНКА</span><h2>Продажи по стадиям</h2></div><Workflow size={22} /></div><div className="funnel-list">{(dashboard?.stages.length ? dashboard.stages : [{id:'1',name:'Новый лид',position:0},{id:'2',name:'В работе',position:1},{id:'3',name:'Консультация',position:2},{id:'4',name:'Оплата',position:3}]).map((stage, index) => <div key={stage.id}><span>{stage.name}</span><i><b style={{width: `${100-index*18}%`}} /></i><strong>{[9,6,3,2][index] ?? 0}</strong></div>)}</div></section>
      <section className="panel blocked-panel"><h2>Интеграции</h2><p>WhatsApp, Instagram, реклама, облако и видеовстречи будут подключаться после выдачи API-ключей.</p></section>
    </div>
  </div>;
}
function TasksView() { return <div className="view-page"><div className="view-title"><h1>Задачи</h1><span>{tasks.length} активных</span></div><h3 className="section-label">Сегодня и просрочено</h3>{tasks.map(([title, priority, tone], index) => <label className="task-row" key={title}><input type="checkbox" defaultChecked={index === 3} /><span>{title}</span><b className={`priority ${tone}`}>{priority}</b></label>)}</div>; }
function ProjectsView() { return <div className="view-page"><div className="view-title"><h1>Проекты</h1><span>Запуск нового направления</span></div><div className="project-board">{[['To do','Согласовать прайс','Снять видео-отзывы'],['In progress','Настроить лендинг','Обучить менеджеров'],['Done','Утвердить бюджет']].map(([title,...cards]) => <section key={title}><h3>{title}</h3>{cards.map(card => <article key={card}>{card}</article>)}</section>)}</div></div>; }
function TeamView() { return <div className="view-page"><div className="view-title"><h1>Команда</h1><span>3 сотрудника</span></div><div className="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Роль</th><th>Отдел</th><th>Статус</th></tr></thead><tbody>{team.map(([initials,name,role,department,status,color]) => <tr key={name}><td><span className="member-avatar" style={{background:color}}>{initials}</span>{name}</td><td><b className="role-chip">{role}</b></td><td>{department}</td><td><i className={status === 'Онлайн' ? 'online' : ''} />{status}</td></tr>)}</tbody></table></div></div>; }
function AccountingView() { return <div className="view-page"><div className="view-title"><h1>Бухгалтерия</h1></div><div className="kpi-grid"><article className="kpi-card"><span>Доход</span><strong className="income">₸ 2 840 000</strong></article><article className="kpi-card"><span>Расход</span><strong className="expense">₸ 640 000</strong></article><article className="kpi-card"><span>Прибыль</span><strong>₸ 2 200 000</strong></article><article className="kpi-card"><span>НДС</span><strong>₸ 340 800</strong></article></div><div className="table-wrap"><table><thead><tr><th>Дата</th><th>Описание</th><th>Счёт</th><th>Сумма</th></tr></thead><tbody><tr><td>01.08</td><td>Оплата — курс лечения</td><td>Касса</td><td className="income">+420 000 ₸</td></tr><tr><td>31.07</td><td>Аренда кабинета</td><td>Расч. счёт</td><td className="expense">−150 000 ₸</td></tr></tbody></table></div></div>; }
