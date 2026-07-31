import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Cable,
  CalendarCheck2,
  LayoutDashboard,
  Menu,
  PhoneCall,
  Search,
  Settings,
  Stethoscope,
  UserRoundCheck,
  UsersRound,
  Workflow,
} from 'lucide-react';

type PageProps = {
  eyebrow: string;
  title: string;
  description: string;
};

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/leads', label: 'Лиды', icon: UsersRound },
  { to: '/patients', label: 'Пациенты', icon: UserRoundCheck },
  { to: '/deals', label: 'Сделки', icon: Workflow },
  { to: '/appointments', label: 'Записи', icon: CalendarCheck2 },
  { to: '/calls', label: 'Звонки', icon: PhoneCall },
  { to: '/doctors', label: 'Врачи', icon: Stethoscope },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { to: '/integrations', label: 'Интеграции', icon: Cable },
  { to: '/settings', label: 'Настройки', icon: Settings },
];

function PlaceholderPage({ eyebrow, title, description }: PageProps) {
  return (
    <div className="page-stack">
      <header className="page-heading">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>

      <section className="content-card empty-module">
        <div className="empty-module__icon">
          <LayoutDashboard size={24} />
        </div>
        <div>
          <h2>Раздел подготовлен</h2>
          <p>Функциональность будет перенесена отдельным этапом без старого кода и лишних зависимостей.</p>
        </div>
      </section>
    </div>
  );
}

function DashboardPage() {
  return (
    <div className="page-stack">
      <header className="page-heading">
        <span>IMDS CRM</span>
        <h1>Dashboard</h1>
        <p>Единая рабочая область для лидов, пациентов, сделок, записей и коммуникаций.</p>
      </header>

      <div className="metric-grid">
        <article className="metric-card"><span>Новые лиды</span><strong>0</strong><small>Данные не подключены</small></article>
        <article className="metric-card"><span>Записи на приём</span><strong>0</strong><small>Данные не подключены</small></article>
        <article className="metric-card"><span>Пациенты</span><strong>0</strong><small>Данные не подключены</small></article>
        <article className="metric-card"><span>Продажи</span><strong>0 ₸</strong><small>Данные не подключены</small></article>
      </div>

      <section className="content-card dashboard-placeholder">
        <div>
          <span className="section-label">ЭТАП 2</span>
          <h2>Чистая оболочка CRM готова</h2>
          <p>Навигация, адаптивный layout и маршрутизация перенесены. Бизнес-модули будут подключаться по одному.</p>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="crm-shell">
      <aside className={sidebarOpen ? 'crm-sidebar crm-sidebar--open' : 'crm-sidebar'}>
        <div className="crm-brand">
          <div className="crm-brand__mark">IM</div>
          <div>
            <strong>IMDS</strong>
            <span>CRM</span>
          </div>
        </div>

        <div className="crm-nav-label">УПРАВЛЕНИЕ</div>
        <nav className="crm-nav">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Закрыть меню" onClick={() => setSidebarOpen(false)} />}

      <main className="crm-main">
        <header className="crm-topbar">
          <button className="menu-button" type="button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Открыть меню">
            <Menu size={21} />
          </button>

          <label className="global-search">
            <Search size={17} />
            <input placeholder="Поиск лидов, пациентов, сделок и записей" />
          </label>

          <div className="topbar-actions">
            <button type="button" aria-label="Уведомления"><Bell size={18} /></button>
            <button type="button" className="profile-button">
              <span>AD</span>
              <div>
                <strong>Администратор</strong>
                <small>Полный доступ</small>
              </div>
            </button>
          </div>
        </header>

        <div className="crm-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/leads" element={<PlaceholderPage eyebrow="CRM" title="Лиды" description="Единый список лидов, источников, ответственных и следующих действий." />} />
            <Route path="/patients" element={<PlaceholderPage eyebrow="MEDICAL CRM" title="Пациенты" description="Карточки пациентов, история обращений, лечения и коммуникаций." />} />
            <Route path="/deals" element={<PlaceholderPage eyebrow="SALES" title="Сделки" description="Воронка продаж, стадии, оплаты, задолженности и результаты." />} />
            <Route path="/appointments" element={<PlaceholderPage eyebrow="SCHEDULE" title="Записи" description="Записи на приём, расписание врачей и статусы посещений." />} />
            <Route path="/calls" element={<PlaceholderPage eyebrow="COMMUNICATIONS" title="Звонки" description="История звонков, записи разговоров и контроль качества." />} />
            <Route path="/doctors" element={<PlaceholderPage eyebrow="TEAM" title="Врачи" description="Врачи, графики, загрузка, результаты и показатели работы." />} />
            <Route path="/analytics" element={<PlaceholderPage eyebrow="BI" title="Аналитика" description="Конверсии, продажи, источники, врачи и операционные показатели." />} />
            <Route path="/integrations" element={<PlaceholderPage eyebrow="SYSTEM" title="Интеграции" description="Подключение внешних каналов, телефонии, мессенджеров и сервисов." />} />
            <Route path="/settings" element={<PlaceholderPage eyebrow="SYSTEM" title="Настройки" description="Пользователи, роли, справочники и параметры CRM." />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
