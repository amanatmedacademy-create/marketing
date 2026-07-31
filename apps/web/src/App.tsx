import {
  BarChart3,
  Bell,
  Cable,
  CalendarDays,
  Cloud,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageCircle,
  Search,
  Settings,
  UsersRound,
  Video,
  WalletCards,
  Workflow,
} from 'lucide-react';

const navigation = [
  { label: 'Дашборд', icon: LayoutDashboard, active: true },
  { label: 'Сделки', icon: Workflow },
  { label: 'Задачи', icon: CalendarDays },
  { label: 'Команда', icon: UsersRound },
  { label: 'Бухгалтерия', icon: WalletCards },
  { label: 'WhatsApp', icon: MessageCircle },
  { label: 'Реклама', icon: Megaphone },
  { label: 'Облако', icon: Cloud },
  { label: 'Видеовстречи', icon: Video },
  { label: 'Интеграции', icon: Cable },
];

const metrics = [
  ['Сумма в работе', '0 ₸'],
  ['Новые сделки', '0'],
  ['Открытые задачи', '0'],
  ['Неотвеченные беседы', '0'],
];

export default function App() {
  return (
    <div className="crm-shell">
      <aside className="sidebar">
        <div className="brand">IM</div>
        <nav>
          {navigation.map(({ label, icon: Icon, active }) => (
            <button key={label} className={active ? 'active' : ''} title={label} aria-label={label}>
              <Icon size={20} />
            </button>
          ))}
        </nav>
        <button className="settings-button" title="Настройки" aria-label="Настройки"><Settings size={20} /></button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Меню"><Menu size={20} /></button>
          <label className="search-box">
            <Search size={18} />
            <input placeholder="Поиск или вопрос AI-ассистенту" />
          </label>
          <div className="topbar-actions">
            <span className="clock">Asia/Almaty</span>
            <button aria-label="Уведомления"><Bell size={19} /></button>
            <button className="avatar">AD</button>
          </div>
        </header>

        <section className="subscription-banner">
          <div><strong>IMDS CRM</strong><span>Cloudflare Worker подключён. Supabase будет добавлен отдельным этапом.</span></div>
          <button>Настроить проект</button>
        </section>

        <div className="content">
          <div className="page-heading">
            <div><span>ОБЗОР</span><h1>Дашборд</h1><p>Рабочая область открывается без экрана входа.</p></div>
            <button className="period-button">Сегодня</button>
          </div>

          <div className="metrics-grid">
            {metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>Данные пока не подключены</small></article>)}
          </div>

          <div className="dashboard-grid">
            <section className="panel chart-panel">
              <div className="panel-heading"><div><span>АНАЛИТИКА</span><h2>Динамика сделок</h2></div><BarChart3 size={22} /></div>
              <div className="empty-chart"><BarChart3 size={44} /><p>График появится после подключения таблиц Supabase.</p></div>
            </section>
            <section className="panel">
              <div className="panel-heading"><div><span>ВОРОНКА</span><h2>Стадии продаж</h2></div><Workflow size={22} /></div>
              <div className="empty-list"><p>Воронка ещё не создана.</p><button>Создать первую воронку</button></div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
